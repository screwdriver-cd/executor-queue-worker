'use strict';

const assert = require('chai').assert;
const mockery = require('mockery');
const sinon = require('sinon');

sinon.assert.expose(assert, { prefix: '' });

describe('Jobs Unit Test', () => {
    let jobs;
    let mockExecutor;
    let mockExecutorRouter;
    let mockRedis;
    let mockRedisObj;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach(() => {
        mockExecutor = {
            start: sinon.stub(),
            stop: sinon.stub()
        };

        mockRedisObj = {
            hget: sinon.stub(),
            hdel: sinon.stub()
        };

        mockExecutorRouter = function () { return mockExecutor; };
        mockery.registerMock('screwdriver-executor-router', mockExecutorRouter);

        mockRedis = sinon.stub().returns(mockRedisObj);
        mockery.registerMock('ioredis', mockRedis);

        // eslint-disable-next-line global-require
        jobs = require('../lib/jobs');
    });

    afterEach(() => {
        mockery.deregisterAll();
        mockery.resetCache();
    });

    after(() => {
        mockery.disable();
    });

    describe('redis constructor', () => {
        it('creates a redis connection given a valid config', () => {
            const expectedPort = 6379;
            const expectedHost = '127.0.0.1';
            const expectedOptions = {
                password: undefined
            };

            assert.calledWith(mockRedis, expectedPort, expectedHost, expectedOptions);
        });
    });

    describe('start', () => {
        it('constructs start job correctly', () =>
            assert.deepEqual(jobs.start, {
                plugins: ['retry'],
                pluginOptions: {
                    retry: {
                        retryLimit: 3,
                        retryDelay: 1000
                    }
                },
                perform: jobs.start.perform
            })
        );

        it('starts a job', () => {
            const expectedConfig = JSON.stringify({
                annotations: {
                    'beta.screwdriver.cd/executor': 'k8s'
                },
                buildId: 8609,
                container: 'node:4',
                apiUri: 'http://api.com',
                token: 'asdf'
            });

            mockExecutor.start.resolves(null);
            mockRedisObj.hget.resolves(expectedConfig);
            mockRedisObj.hdel.resolves(1);

            return jobs.start.perform({ buildId: expectedConfig.buildId }, (err, result) => {
                assert.isNull(err);
                assert.isNull(result);

                assert.calledWith(mockExecutor.start, JSON.parse(expectedConfig));

                assert.calledWith(mockRedisObj.hget, 'buildConfigs', expectedConfig.buildId);
                assert.calledWith(mockRedisObj.hdel, 'buildConfigs', expectedConfig.buildId);
            });
        });

        it('returns an error from executor', () => {
            mockRedisObj.hget.resolves('{}');
            mockRedisObj.hdel.resolves(1);

            const expectedError = new Error('executor.start Error');

            mockExecutor.start.rejects(expectedError);

            return jobs.start.perform({}, (err) => {
                assert.deepEqual(err, expectedError);
            });
        });

        it('returns an error when redis fails to get a config', () => {
            const expectedError = new Error('hget error');

            mockRedisObj.hget.rejects(expectedError);

            return jobs.start.perform({}, (err) => {
                assert.deepEqual(err, expectedError);
            });
        });

        it('returns an error when redis fails to remove a config', () => {
            const expectedError = new Error('hdel error');

            mockRedisObj.hget.resolves('{}');
            mockRedisObj.hdel.rejects(expectedError);

            return jobs.start.perform({}, (err) => {
                assert.deepEqual(err, expectedError);
            });
        });
    });

    describe('stop', () => {
        it('constructs stop job correctly', () =>
            assert.deepEqual(jobs.stop, {
                plugins: ['retry'],
                pluginOptions: {
                    retry: {
                        retryLimit: 3,
                        retryDelay: 1000
                    }
                },
                perform: jobs.stop.perform
            })
        );

        it('stops a job', () => {
            const expectedConfig = { buildConfig: 'buildConfig' };

            mockExecutor.stop.resolves(null);
            mockRedisObj.hdel.resolves(1);

            return jobs.stop.perform(expectedConfig, (err, result) => {
                assert.isNull(err);
                assert.isNull(result);

                assert.calledWith(mockRedisObj.hdel, 'buildConfigs', expectedConfig.buildId);
                assert.calledWith(mockExecutor.stop, expectedConfig);
            });
        });

        it('returns an error from stopping executor', () => {
            const expectedError = new Error('executor.stop Error');

            mockRedisObj.hdel.resolves(1);
            mockExecutor.stop.rejects(expectedError);

            return jobs.stop.perform({}, (err) => {
                assert.deepEqual(err, expectedError);
            });
        });

        it('returns an error when redis fails to remove a config', () => {
            const expectedError = new Error('hdel error');

            mockRedisObj.hdel.rejects(expectedError);

            return jobs.stop.perform({}, (err) => {
                assert.deepEqual(err, expectedError);
            });
        });
    });
});
