'use strict';

const config = require('config');

const rabbitmqConfig = config.get('scheduler').rabbitmq;
const { protocal, username, password, host, port, exchange, exchangeType } = rabbitmqConfig;
const amqpURI = `${protocal}://${username}:${password}@${host}:${port}`;
const schedulerMode = config.get('scheduler').enabled;

/**
 * get configurations for rabbitmq
 * @method getConfig
 * @return {Object}
 */
function getConfig() {
    return {
        schedulerMode,
        amqpURI,
        exchange,
        exchangeType
    };
}

module.exports = { getConfig };
