'use strict';

const config = require('config');

const rabbitmqConfig = config.get('scheduler').rabbitmq;
const { protocal, username, password, host, port, exchange } = rabbitmqConfig;
const amqpURI = `${protocal}://${username}:${password}@${host}:${port}`;

module.exports = {
    amqpURI,
    exchange
};
