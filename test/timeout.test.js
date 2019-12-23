'use strict';

const assert = require('chai').assert;
const mockery = require('mockery');
const sinon = require('sinon');

sinon.assert.expose(assert, { prefix: '' });

let deleteKey;
let expireKey;
let waitingKey;

describe('Timeout test', () => {
    const queuePrefix = 'mockQueuePrefix_';
    const runningJobsPrefix = undefined;
    const waitingJobsPrefix = undefined;
    let mockRequest;
    let mockRedis;
    let mockRedisConfig;
    let helperMock;
    let timeout;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach(() => {
        mockRequest = sinon.stub();
        mockRedis = {
            hget: sinon.stub().resolves(),
            hdel: sinon.stub().resolves(null),
            get: sinon.stub().resolves(null),
            expire: sinon.stub().resolves(),
            del: sinon.stub().resolves(),
            lrem: sinon.stub().resolves(),
            hkeys: sinon.stub().resolves()
        };

        mockRedisConfig = {
            queuePrefix: 'mockQueuePrefix_'
        };
        helperMock = {
            updateBuildStatus: sinon.stub()
        };

        mockery.registerMock('request', mockRequest);
        mockery.registerMock('../config/redis', mockRedisConfig);
        mockery.registerMock('./helper.js', helperMock);

        // eslint-disable-next-line global-require
        timeout = require('../lib/timeout.js');
    });

    afterEach(() => {
        mockery.deregisterAll();
        mockery.resetCache();
        process.removeAllListeners('SIGTERM');
    });

    after(() => {
        mockery.disable();
    });

    describe('check', () => {
        beforeEach(() => {
            expireKey = `${runningJobsPrefix}2`;
            waitingKey = `${waitingJobsPrefix}2`;

            mockRedis.hkeys.withArgs(`${queuePrefix}buildConfigs`)
                .resolves(['222', '333', '444']);
        });

        it('Updates build status to FAILURE if time difference is greater than timeout'
            , async () => {
                const now = new Date();

                now.setHours(now.getHours() - 1);

                // helperMock.updateBuildStatus.yieldsAsync(null, {});

                const buildId = '333';
                const buildConfig = {
                    jobId: 2,
                    jobName: 'deploy',
                    annotations: {
                        timeout: '50'
                    },
                    apiUri: 'fake',
                    buildId,
                    eventId: 75,
                    enqueueTime: now
                };

                deleteKey = `deleted_${buildConfig.jobId}_${buildId}`;

                mockRedis.hget.withArgs(`${queuePrefix}buildConfigs`, buildId)
                    .resolves(JSON.stringify(buildConfig));

                await timeout.check(mockRedis);

                assert.calledWith(helperMock.updateBuildStatus, {
                    redisInstance: mockRedis,
                    buildId,
                    status: 'FAILURE',
                    statusMessage: `Failed build: ${buildId} due to timeout`
                });
                assert.calledWith(mockRedis.hdel, `${queuePrefix}buildConfigs`, buildId);
                assert.calledWith(mockRedis.expire, expireKey, 0);
                assert.calledWith(mockRedis.expire, expireKey, 0);

                assert.calledWith(mockRedis.del, deleteKey);
                assert.calledWith(mockRedis.lrem, waitingKey, 0, buildId);
            });

        it('Updatebuildstatus not called if time difference still less than timeout', async () => {
            const now = new Date();

            now.setMinutes(now.getMinutes() - 20);

            const buildId = '333';
            const buildConfig = {
                jobId: 2,
                jobName: 'deploy',
                annotations: {
                    timeout: '50'
                },
                apiUri: 'fake',
                buildId,
                eventId: 76,
                enqueueTime: now
            };

            mockRedis.hget.withArgs(`${queuePrefix}buildConfigs`, buildId)
                .resolves(JSON.stringify(buildConfig));

            await timeout.check(mockRedis);

            assert.notCalled(helperMock.updateBuildStatus);
            assert.notCalled(mockRedis.expire);
            assert.notCalled(mockRedis.del);
            assert.notCalled(mockRedis.lrem);
        });

        it('No op if enqueue time is not set in build config', async () => {
            const buildId = '222';
            const buildConfig = {
                jobId: 2,
                jobName: 'deploy',
                annotations: {
                    timeout: '50'
                },
                apiUri: 'fake',
                buildId,
                eventId: 76
            };

            mockRedis.hget.withArgs(`${queuePrefix}buildConfigs`, buildId)
                .resolves(JSON.stringify(buildConfig));

            await timeout.check(mockRedis);

            assert.notCalled(helperMock.updateBuildStatus);
            assert.notCalled(mockRedis.expire);
            assert.notCalled(mockRedis.del);
            assert.notCalled(mockRedis.lrem);
        });
    });
});
