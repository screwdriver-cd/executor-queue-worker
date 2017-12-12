'use strict';

const Redis = require('ioredis');
const config = require('config');
const winston = require('winston');
const { connectionDetails, queuePrefix } = require('../config/redis');

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

const ExecutorRouter = require('screwdriver-executor-router');
const executor = new ExecutorRouter({
    defaultPlugin: executorConfig.plugin,
    executor: executorPlugins,
    ecosystem
});
const RETRY_LIMIT = 3;
const RETRY_DELAY = 5;
const retryOptions = {
    plugins: ['retry'],
    pluginOptions: {
        retry: {
            retryLimit: RETRY_LIMIT,
            retryDelay: RETRY_DELAY
        }
    }
};

/**
 * Call executor.start with the buildConfig obtained from the redis database
 * @method start
 * @param {Object}    buildConfig               Configuration object
 * @param {String}    buildConfig.buildId       Unique ID for a build
 * @param {Function}  callback                  Callback fn(error, result)
 */
function start(buildConfig, callback) {
    return redis.hget(`${queuePrefix}buildConfigs`, buildConfig.buildId)
        .then(fullBuildConfig => executor.start(JSON.parse(fullBuildConfig)))
        .then(result => callback(null, result), (err) => {
            winston.error('err in start job: ', err);
            callback(err);
        });
}

/**
 * Call executor.stop with the buildConfig
 * @method stop
 * @param {Object}     buildConfig                Configuration object
 * @param {String}     buildConfig.buildId        Unique ID for a build
 * @param {Function}   callback                   Callback fn(error, result)
 */
function stop(buildConfig, callback) {
    const stopId = buildConfig.buildId;
    const stopConfig = { buildId: stopId };

    return redis.hget(`${queuePrefix}buildConfigs`, stopId)
        .then((fullBuildConfig) => {
            const parsedConfig = JSON.parse(fullBuildConfig);

            if (parsedConfig && parsedConfig.annotations) {
                stopConfig.annotations = parsedConfig.annotations;
            }
        })
        .catch((err) => {
            winston.error(`[Stop Build] failed to get config for build ${stopId}: ${err.message}`);
        })
        .then(() => redis.hdel(`${queuePrefix}buildConfigs`, stopId))
        .then(() => executor.stop(stopConfig))
        .then(result => callback(null, result), err => callback(err));
}

module.exports = {
    start: Object.assign({ perform: start }, retryOptions),
    stop: Object.assign({ perform: stop }, retryOptions)
};
