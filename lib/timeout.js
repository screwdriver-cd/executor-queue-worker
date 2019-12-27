'use strict';

const helper = require('./helper.js');
const hoek = require('hoek');
const { waitingJobsPrefix, runningJobsPrefix, queuePrefix } = require('../config/redis');
const logger = require('screwdriver-logger');
const DEFAULT_BUILD_TIMEOUT = 60;

/**
 * Check if the build has timed out
 * If yes, abort build.
 * @method check
 * @return {Promise}
 */
async function check(redis) {
    try {
        const keys = await redis.hkeys(`${queuePrefix}buildConfigs`);

        if (!keys || keys.length === 0) return;

        await Promise.all(keys.map(async (buildId) => {
            const json = await redis.hget(
                `${queuePrefix}buildConfigs`, buildId);

            if (!json) return;

            const buildConfig = JSON.parse(json);

            if (!buildConfig) {
                // this build or pipeline has already been deleted
                return;
            }

            const jobId = buildConfig.jobId;
            const runningKey = `${runningJobsPrefix}${jobId}`;
            const lastRunningKey = `last_${runningJobsPrefix}${jobId}`;
            const waitingKey = `${waitingJobsPrefix}${jobId}`;
            const deleteKey = `deleted_${jobId}_${buildId}`;

            const annotations = hoek.reach(buildConfig, 'annotations', { default: {} });
            const timeout = parseInt(annotations.timeout || DEFAULT_BUILD_TIMEOUT, 10);
            const startTime = buildConfig.enqueueTime;

            if (!startTime) {
                // there is no enqueue time set for the build
                logger.warn(`EnqueueTime not set for buildId: ${buildId}`);

                return;
            }

            const diffMs = (new Date()).getTime() - new Date(startTime).getTime();
            const diffMins = Math.round(diffMs / 60000);

            // check if build has timed out, if yes abort build
            if (diffMins > timeout) {
                logger.info(`Build has timed out ${buildId}`);

                await helper.updateBuildStatus({
                    redisInstance: redis,
                    buildId,
                    status: 'FAILURE', // 'ABORTED'
                    statusMessage: `Failed build: ${buildId} due to timeout`
                }, () => { });

                await redis.hdel(`${queuePrefix}buildConfigs`, buildId);

                // expire now as build aborted
                await redis.expire(runningKey, 0);
                await redis.expire(lastRunningKey, 0);

                await redis.del(deleteKey);
                await redis.lrem(waitingKey, 0, buildId);
            }
        }));
    } catch (err) {
        logger.error(`Error occured while checking timeout ${err}`);
    }
}

module.exports.check = check;
