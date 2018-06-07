'use strict';

const Redis = require('ioredis');
const config = require('config');
const winston = require('winston');
const BlockedBy = require('./BlockedBy').BlockedBy;
const blockedByConfig = config.get('plugins').blockedBy;
const ExecutorRouter = require('screwdriver-executor-router');
const { connectionDetails, queuePrefix, runningJobsPrefix, waitingJobsPrefix }
= require('../config/redis');

const RETRY_LIMIT = 3;
const RETRY_DELAY = 5;
const redis = new Redis(connectionDetails.port, connectionDetails.host, connectionDetails.options);

const ecosystem = config.get('ecosystem');
const executorConfig = config.get('executor');
const executorPlugins = Object.keys(executorConfig).reduce((aggregator, keyName) => {
    if (keyName !== 'plugin') {
        aggregator.push(Object.assign({
            name: keyName
        }, executorConfig[keyName]));
    }

    return aggregator;
}, []);
const executor = new ExecutorRouter({
    defaultPlugin: executorConfig.plugin,
    executor: executorPlugins,
    ecosystem
});
const retryOptions = {
    retryLimit: RETRY_LIMIT,
    retryDelay: RETRY_DELAY
};
const blockedByOptions = {
    // TTL of key, same value as build timeout so that
    // blocked job is not stuck forever in the case cleanup failed to run
    blockTimeout: blockedByConfig.blockTimeout,

    // Time to reEnqueue
    reenqueueWaitTime: blockedByConfig.reenqueueWaitTime,

    blockedBySelf: blockedByConfig.blockedBySelf
};

/**
 * Call executor.start with the buildConfig obtained from the redis database
 * @method start
 * @param  {Object}    buildConfig               Configuration object
 * @param  {String}    buildConfig.buildId       Unique ID for a build
 * @param  {String}    buildConfig.jobId         Job that this build belongs to
 * @param  {String}    buildConfig.blockedBy     Jobs that are blocking this job
 * @return {Promise}
 */
function start(buildConfig) {
    return redis.hget(`${queuePrefix}buildConfigs`, buildConfig.buildId)
        .then(fullBuildConfig => executor.start(JSON.parse(fullBuildConfig)))
        .catch((err) => {
            winston.error('err in start job: ', err);

            return Promise.reject(err);
        });
}

/**
 * Call executor.stop with the buildConfig
 * @method stop
 * @param  {Object}    buildConfig               Configuration object
 * @param  {String}    buildConfig.buildId       Unique ID for a build
 * @param  {String}    buildConfig.jobId         Job that this build belongs to
 * @param  {String}    buildConfig.blockedBy     Jobs that are blocking this job
 * @return {Promise}
 */
function stop(buildConfig) {
    const { buildId, jobId } = buildConfig;
    const stopConfig = { buildId };

    return redis.hget(`${queuePrefix}buildConfigs`, buildId)
        .then((fullBuildConfig) => {
            const parsedConfig = JSON.parse(fullBuildConfig);

            if (parsedConfig && parsedConfig.annotations) {
                stopConfig.annotations = parsedConfig.annotations;
            }
        })
        .catch((err) => {
            winston.error(`[Stop Build] failed to get config for build ${buildId}: ${err.message}`);
        })
        .then(() => redis.hdel(`${queuePrefix}buildConfigs`, buildId))
        // If this is a running job
        .then(() => redis.del(`${runningJobsPrefix}${jobId}`))
        // If this is a waiting job
        .then(() => redis.lrem(`${waitingJobsPrefix}${jobId}`, 0, buildId))
        .then(() => executor.stop(stopConfig));
}

module.exports = {
    start: {
        plugins: ['Retry', BlockedBy],
        pluginOptions: {
            Retry: retryOptions,
            BlockedBy: blockedByOptions
        },
        perform: start
    },
    stop: {
        plugins: ['Retry'], // stop shouldn't use blockedBy
        pluginOptions: {
            Retry: retryOptions
        },
        perform: stop
    }
};
