'use strict';

const assert = require('chai').assert;
const mockery = require('mockery');
const sinon = require('sinon');

sinon.assert.expose(assert, { prefix: '' });

describe('rabbitmq config test', () => {
    const rabbitmq = {
        protocol: 'amqp',
        username: 'foo',
        password: 'bar',
        host: 'localhost',
        port: 5672,
        exchange: 'build',
        exchangeType: 'topic',
        vhost: '/screwdriver'
    };
    let configMock;
    let rabbitmqConfig;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach(() => {
        configMock = {
            get: sinon.stub().returns({
                enabled: false,
                rabbitmq
            })
        };

        mockery.registerMock('config', configMock);

        // eslint-disable-next-line global-require
        rabbitmqConfig = require('../config/rabbitmq');
    });

    it('populates the correct values', () => {
        assert.deepEqual(rabbitmqConfig.getConfig(), {
            schedulerMode: false,
            amqpURI: 'amqp://foo:bar@localhost:5672/screwdriver',
            exchange: rabbitmq.exchange,
            exchangeType: rabbitmq.exchangeType
        });
    });

    afterEach(() => {
        mockery.deregisterAll();
        mockery.resetCache();
    });

    after(() => {
        mockery.disable();
    });
});
