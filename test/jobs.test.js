'use strict';

const assert = require('chai').assert;
const mockery = require('mockery');
const sinon = require('sinon');
const fullConfig = {
    annotations: {
        'beta.screwdriver.cd/executor': 'k8s'
    },
    buildId: 8609,
    jobId: 777,
    blockedBy: [777],
    container: 'node:4',
    apiUri: 'http://api.com',
    token: 'asdf'
};
const partialConfig = {
    buildId: 8609,
    jobId: 777,
    blockedBy: [777]
};

sinon.assert.expose(assert, { prefix: '' });

describe('Jobs Unit Test', () => {
    let jobs;
    let mockExecutor;
    let mockExecutorRouter;
    let mockRedis;
    let mockRedisObj;
    let mockBlockedBy;

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
            hdel: sinon.stub(),
            del: sinon.stub()
        };

        mockExecutorRouter = function () { return mockExecutor; };
        mockery.registerMock('screwdriver-executor-router', mockExecutorRouter);

        mockRedis = sinon.stub().returns(mockRedisObj);
        mockery.registerMock('ioredis', mockRedis);

        mockBlockedBy = sinon.stub().returns();
        mockery.registerMock('./BlockedBy', mockBlockedBy);

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
                password: undefined,
                tls: false
            };

            assert.calledWith(mockRedis, expectedPort, expectedHost, expectedOptions);
        });
    });

    describe('start', () => {
        it('constructs start job correctly', () =>
            assert.deepEqual(jobs.start, {
                plugins: ['Retry', mockBlockedBy],
                pluginOptions: {
                    Retry: {
                        retryLimit: 3,
                        retryDelay: 5
                    },
                    BlockedBy: {
                        reenqueueWaitTime: 300,
                        lockTimeout: 7200
                    }
                },
                perform: jobs.start.perform
            })
        );

        it('starts a job', () => {
            mockExecutor.start.resolves(null);
            mockRedisObj.hget.resolves(JSON.stringify(fullConfig));

            return jobs.start.perform(partialConfig)
                .then((result) => {
                    assert.isNull(result);

                    assert.calledWith(mockExecutor.start, fullConfig);
                    assert.calledWith(mockRedisObj.hget, 'buildConfigs', fullConfig.buildId);
                });
        });

        it('returns an error from executor', () => {
            mockRedisObj.hget.resolves('{}');
            mockRedisObj.hdel.resolves(1);

            const expectedError = new Error('executor.start Error');

            mockExecutor.start.rejects(expectedError);

            return jobs.start.perform({}).then(() => {
                assert.fail('Should not get here');
            }, (err) => {
                assert.deepEqual(err, expectedError);
            });
        });

        it('returns an error when redis fails to get a config', () => {
            const expectedError = new Error('hget error');

            mockRedisObj.hget.rejects(expectedError);

            return jobs.start.perform({}).then(() => {
                assert.fail('Should not get here');
            }, (err) => {
                assert.deepEqual(err, expectedError);
            });
        });
    });

    describe('stop', () => {
        it('constructs stop job correctly', () =>
            assert.deepEqual(jobs.stop, {
                plugins: ['Retry'],
                pluginOptions: {
                    Retry: {
                        retryLimit: 3,
                        retryDelay: 5
                    }
                },
                perform: jobs.stop.perform
            })
        );

        it('stops a job', () => {
            mockExecutor.stop.resolves(null);
            mockRedisObj.hget.resolves(JSON.stringify(fullConfig));
            mockRedisObj.hdel.resolves(1);
            mockRedisObj.del.resolves(null);

            return jobs.stop.perform(partialConfig).then((result) => {
                assert.isNull(result);
                assert.calledWith(mockRedisObj.hget, 'buildConfigs', fullConfig.buildId);
                assert.calledWith(mockRedisObj.hdel, 'buildConfigs', fullConfig.buildId);
                assert.calledWith(mockExecutor.stop, {
                    annotations: fullConfig.annotations,
                    buildId: fullConfig.buildId
                });
            });
        });

        it('stop a build anyway when redis fails to get a config', () => {
            const expectedError = new Error('hget error');

            mockExecutor.stop.resolves(null);
            mockRedisObj.hget.rejects(expectedError);

            return jobs.stop.perform(partialConfig).then((result) => {
                assert.isNull(result);
                assert.calledWith(mockRedisObj.hget, 'buildConfigs', fullConfig.buildId);
                assert.calledWith(mockExecutor.stop, { buildId: fullConfig.buildId });
            });
        });

        it('returns an error from stopping executor', () => {
            const expectedError = new Error('executor.stop Error');

            mockRedisObj.hget.resolves('{}');
            mockRedisObj.hdel.resolves(1);
            mockExecutor.stop.rejects(expectedError);

            return jobs.stop.perform({}).then(() => {
                assert.fail('Should not get here');
            }, (err) => {
                assert.deepEqual(err, expectedError);
            });
        });

        it('returns an error when redis fails to remove a config', () => {
            const expectedError = new Error('hdel error');

            mockRedisObj.hget.resolves('{}');
            mockRedisObj.hdel.rejects(expectedError);

            return jobs.stop.perform({}).then(() => {
                assert.fail('Should not get here');
            }, (err) => {
                assert.deepEqual(err, expectedError);
            });
        });
    });
});
