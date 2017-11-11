'use strict';

const Redis = require('ioredis');
const config = require('config');
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
        .then(JSON.parse)
        .then(fullBuildConfig => redis.hdel(`${queuePrefix}buildConfigs`, buildConfig.buildId)
            .then(() => executor.start(fullBuildConfig)))
        .then(result => callback(null, result), err => callback(err));
}

/**
 * Call executor.stop with the buildConfig
 * @method stop
 * @param {Object}     buildConfig                Configuration object
 * @param {String}     buildConfig.buildId        Unique ID for a build
 * @param {Function}   callback                   Callback fn(error, result)
 */
function stop(buildConfig, callback) {
    return redis.hdel(`${queuePrefix}buildConfigs`, buildConfig.buildId)
        .then(() => executor.stop(buildConfig))
        .then(result => callback(null, result), err => callback(err));
}

module.exports = {
    start: Object.assign({ perform: start }, retryOptions),
    stop: Object.assign({ perform: stop }, retryOptions)
};
