'use strict';

const helper = require('./helper.js');
const { waitingJobsPrefix, runningJobsPrefix, queuePrefix } = require('../config/redis');
const logger = require('screwdriver-logger');
const TIMEOUT_CODE = 3;
const TIMEOUT_BUFFER = 1;

/**
 * Wrapper function to process timeout logic
 * @method process
 * @param {Object} timeoutConfig
 * @param {String} buildId
 * @param {Object} redis
 * @return {Promise}
 */
async function process(timeoutConfig, buildId, redis) {
    try {
        const jobId = timeoutConfig.jobId;
        const runningKey = `${runningJobsPrefix}${jobId}`;
        const lastRunningKey = `last_${runningJobsPrefix}${jobId}`;
        const waitingKey = `${waitingJobsPrefix}${jobId}`;
        const deleteKey = `deleted_${jobId}_${buildId}`;
        const timeout = parseInt(timeoutConfig.timeout, 10) + TIMEOUT_BUFFER; // set timeout 1 min more than the launcher
        const startTime = timeoutConfig.startTime;

        if (!startTime) {
            // there is no startTime set for the build
            logger.warn(`startTime not set for buildId: ${buildId}`);

            return;
        }

        const diffMs = (new Date()).getTime() - new Date(startTime).getTime();
        const diffMins = Math.round(diffMs / 60000);

        // check if build has timed out, if yes abort build
        if (diffMins > timeout) {
            logger.info(`Build has timed out ${buildId}`);

            let step;

            try {
                step = await helper.getCurrentStep({
                    redisInstance: redis,
                    buildId
                });
            } catch (err) {
                logger.error(`No active step found for  ${buildId}`);
            }

            if (step) {
                await helper.updateStepStop({
                    redisInstance: redis,
                    buildId,
                    stepName: step.name,
                    code: TIMEOUT_CODE
                });
            }

            await helper.updateBuildStatus({
                redisInstance: redis,
                buildId,
                status: 'FAILURE',
                statusMessage: 'Build failed due to timeout'
            }, () => { });

            await redis.hdel(`${queuePrefix}buildConfigs`, buildId);

            // expire now as build failed
            await redis.expire(runningKey, 0);
            await redis.expire(lastRunningKey, 0);

            await redis.del(deleteKey);
            await redis.lrem(waitingKey, 0, buildId);
        }
    } catch (err) {
        // delete key from redis in case of error to prevent reprocessing
        await redis.hdel(`${queuePrefix}timeoutConfigs`, buildId);

        logger.error(`Error occured while checking timeout ${err}`);
    }
}

/**
 * Check if the build has timed out
 * If yes, abort build.
 * @method check
 * @param {Object} redis
 * @return {Promise}
 */
async function check(redis) {
    const keys = await redis.hkeys(`${queuePrefix}timeoutConfigs`);

    if (!keys || keys.length === 0) return;

    await Promise.all(keys.map(async (buildId) => {
        const json = await redis.hget(`${queuePrefix}timeoutConfigs`, buildId);

        if (!json) return;
        const timeoutConfig = JSON.parse(json);

        if (!timeoutConfig) {
            // this build or pipeline has already been deleted
            return;
        }

        await process(timeoutConfig, buildId, redis);
    }));
}

module.exports.check = check;
