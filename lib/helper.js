'use strict';

const request = require('request');
const { queuePrefix } = require('../config/redis');
const winston = require('winston');

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
        .then(fullBuildConfig => request({
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
            winston.info(`Request: ${JSON.stringify({
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
            }, null, 2)}`);
            winston.info(`Response: ${JSON.stringify(response, null, 2)}`);
            if (!err && response.statusCode === 200) {
                return callback(null);
            }

            return callback(err, response);
        }));
}

module.exports = {
    updateBuildStatus
};
