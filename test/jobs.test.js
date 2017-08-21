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
        it('starts a job', (done) => {
            const expectedConfig = {
                annotations: {
                    'beta.screwdriver.cd/executor': 'k8s'
                },
                buildId: 8609,
                container: 'node:4',
                apiUri: 'http://api.com',
                token: 'asdf'
            };

            mockExecutor.start.resolves(null);
            mockRedisObj.hget.resolves(expectedConfig);
            mockRedisObj.hdel.resolves(1);

            jobs.start({ buildId: expectedConfig.buildId }, (err, result) => {
                assert.isNull(err);
                assert.isNull(result);

                assert.calledWith(mockExecutor.start, expectedConfig);

                assert.calledWith(mockRedisObj.hget, 'buildConfigs', expectedConfig.buildId);
                assert.calledWith(mockRedisObj.hdel, 'buildConfigs', expectedConfig.buildId);

                done();
            });
        });

        it('returns an error from executor', (done) => {
            mockRedisObj.hget.resolves({});
            mockRedisObj.hdel.resolves(1);

            const expectedError = new Error('executor.start Error');

            mockExecutor.start.rejects(expectedError);

            jobs.start({}, (err) => {
                assert.deepEqual(err, expectedError);

                done();
            });
        });

        it('returns an error when redis fails to get a config', (done) => {
            const expectedError = new Error('hget error');

            mockRedisObj.hget.rejects(expectedError);

            jobs.start({}, (err) => {
                assert.deepEqual(err, expectedError);

                done();
            });
        });

        it('returns an error when redis fails to remove a config', (done) => {
            const expectedError = new Error('hdel error');

            mockRedisObj.hget.resolves({});
            mockRedisObj.hdel.rejects(expectedError);

            jobs.start({}, (err) => {
                assert.deepEqual(err, expectedError);

                done();
            });
        });
    });

    describe('stop', () => {
        it('stops a job', (done) => {
            const expectedConfig = { buildConfig: 'buildConfig' };

            mockExecutor.stop.resolves(null);
            mockRedisObj.hdel.resolves(1);

            jobs.stop(expectedConfig, (err, result) => {
                assert.isNull(err);
                assert.isNull(result);

                assert.calledWith(mockRedisObj.hdel, 'buildConfigs', expectedConfig.buildId);
                assert.calledWith(mockExecutor.stop, expectedConfig);

                done();
            });
        });

        it('returns an error from stopping executor', (done) => {
            const expectedError = new Error('executor.stop Error');

            mockRedisObj.hdel.resolves(1);
            mockExecutor.stop.rejects(expectedError);

            jobs.stop({}, (err) => {
                assert.deepEqual(err, expectedError);

                done();
            });
        });

        it('returns an error when redis fails to remove a config', (done) => {
            const expectedError = new Error('hdel error');

            mockRedisObj.hdel.rejects(expectedError);

            jobs.stop({}, (err) => {
                assert.deepEqual(err, expectedError);

                done();
            });
        });
    });
});
