'use strict';

const request = require('request');
const { queuePrefix } = require('../config/redis');
const winston = require('winston');

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    transports: [
        new (winston.transports.Console)({ timestamp: true })
    ]
});

/**
 * Get logger object for model
 * @method getLogger
 * @return {Object}  winston logger object for model
 */
function getLogger() {
    return logger;
}

/**
 * Update build status to FAILURE
 * @method updateBuildStatus
 * @param  {Object}          updateConfig              build config of the job
 * @param  {Function}        [callback]                Callback function
 * @return {Object}          err                       Callback with err object
 */
function updateBuildStatus(updateConfig, callback) {
    const { redisInstance, status, statusMessage, buildId } = updateConfig;

    return redisInstance.hget(`${queuePrefix}buildConfigs`, buildId)
        .then(JSON.parse)
        .then((fullBuildConfig) => {
            // if fullBuildConfig got deleted already, do not update
            if (!fullBuildConfig) return null;

            return request({
                json: true,
                method: 'PUT',
                uri: `${fullBuildConfig.apiUri}/v4/builds/${buildId}`,
                body: {
                    status,
                    statusMessage
                },
                auth: {
                    bearer: fullBuildConfig.token
                }
            }, (err, response) => {
                if (!err && response.statusCode === 200) {
                    return callback(null);
                }

                return callback(err, response);
            });
        });
}

module.exports = {
    updateBuildStatus,
    getLogger
};
