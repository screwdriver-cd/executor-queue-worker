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
 * @method updateStepStop
 * @param {Object} stepConfig
 * @param {Object} stepConfig.redisInstance
 * @param {String} stepConfig.buildId
 * @param {String} stepConfig.stepName
 * @param {Integer} stepConfig.code
 * @return {Promise} response body or error
 */
async function updateStepStop(stepConfig) {
    const { redisInstance, buildId, stepName, code } = stepConfig;
    const buildConfig = await redisInstance.hget(`${queuePrefix}buildConfigs`, buildId)
        .then(JSON.parse);

    // if buildConfig got deleted already, do not update
    if (!buildConfig) return null;

    return new Promise((resolve, reject) => {
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
}

/**
 * Gets the current active step in the build
* @method getCurrentStep
 * @param {Object} config
 * @param {Object} config.redisInstance
 * @param {String} config.buildId
 * @return {Promise} active step or error
 */
async function getCurrentStep(config) {
    const { redisInstance, buildId } = config;
    const buildConfig = await redisInstance.hget(`${queuePrefix}buildConfigs`, buildId)
        .then(JSON.parse);

    // if buildConfig got deleted already, do not update
    if (!buildConfig) return null;

    return new Promise((resolve, reject) => {
        request({
            json: true,
            method: 'GET',
            uri: `${buildConfig.apiUri}/v4/builds/${buildId}/steps?status=active`,
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
}

module.exports = {
    updateBuildStatus,
    updateStepStop,
    getCurrentStep
};
