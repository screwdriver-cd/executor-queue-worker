'use strict';

const assert = require('chai').assert;
const mockery = require('mockery');
const sinon = require('sinon');

sinon.assert.expose(assert, { prefix: '' });

describe('redis config test', () => {
    let configMock;
    let redisConfig;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach(() => {
        configMock = {
            get: sinon.stub().returns({
                host: 'mockhost',
                port: '1234',
                password: 'SUPER_SECURE_PASSWORD',
                prefix: 'mockPrefix_',
                tls: false
            })
        };

        mockery.registerMock('config', configMock);

        // eslint-disable-next-line global-require
        redisConfig = require('../config/redis');
    });

    it('populates the correct values', () => {
        assert.deepEqual(redisConfig, {
            connectionDetails: {
                pkg: 'ioredis',
                host: 'mockhost',
                options: {
                    password: 'SUPER_SECURE_PASSWORD',
                    tls: false
                },
                port: '1234',
                database: 0
            },
            queuePrefix: 'mockPrefix_',
            runningJobsPrefix: 'mockPrefix_running_job_',
            waitingJobsPrefix: 'mockPrefix_waiting_job_'
        });
    });

    it('defaults prefix to empty', () => {
        configMock.get.returns({
            mockPrefix: undefined
        });

        mockery.resetCache();

        // eslint-disable-next-line global-require
        redisConfig = require('../config/redis');

        assert.strictEqual(redisConfig.queuePrefix, '');
    });

    afterEach(() => {
        mockery.deregisterAll();
        mockery.resetCache();
    });

    after(() => {
        mockery.disable();
    });
});
