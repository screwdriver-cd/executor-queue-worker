'use strict';

const request = require('request');
const { queuePrefix } = require('../config/redis');

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

/**
 * Updates the step with code and end time
 * @param {Object} stepConfig
 * @param {Object} redisInstance
 * @param {String} buildId
 * @param {String} stepName
 * @param {Integer} code
 */
async function updateStepStop(stepConfig) {
    const { redisInstance, buildId, stepName, code } = stepConfig;
    const buildConfig = await redisInstance.hget(`${queuePrefix}buildConfigs`, buildId)
        .then(JSON.parse);

    // if buildConfig got deleted already, do not update
    if (!buildConfig) return null;

    const promise = () => new Promise((resolve, reject) => {
        request({
            json: true,
            method: 'PUT',
            uri: `${buildConfig.apiUri}/v4/builds/${buildId}/steps/${stepName}`,
            body: {
                endTime: new Date().toISOString(),
                code
            },
            auth: {
                bearer: buildConfig.token
            }
        }, (err, res) => {
            if (!err && res.statusCode === 200) {
                return resolve(res.body);
            }

            return reject(err);
        });
    });

    return promise();
}

/**
 * Gets the current active step in the build
 * @param {Object} redisInstance
 * @param {String} buildId
 * @param {Object} config
 */
async function getCurrentStep(config) {
    const { redisInstance, buildId } = config;
    const buildConfig = await redisInstance.hget(`${queuePrefix}buildConfigs`, buildId)
        .then(JSON.parse);

    // if buildConfig got deleted already, do not update
    if (!buildConfig) return null;

    const promise = () => new Promise((resolve, reject) => {
        request({
            json: true,
            method: 'GET',
            uri: `${buildConfig.apiUri}/v4/builds/${buildId}/steps/active`,
            auth: {
                bearer: buildConfig.token
            }
        }, (err, res) => {
            if (!err && res.statusCode === 200) {
                return resolve(res.body);
            }

            return reject(err);
        });
    });

    return promise();
}

module.exports = {
    updateBuildStatus,
    updateStepStop,
    getCurrentStep
};
