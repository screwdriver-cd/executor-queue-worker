'use strict';

const assert = require('chai').assert;
const mockery = require('mockery');
const sinon = require('sinon');

sinon.assert.expose(assert, { prefix: '' });

describe('Plugin Test', () => {
    const DEFAULT_BLOCKTIMEOUT = 120;
    const DEFAULT_ENQUEUETIME = 1;
    const jobId = 777;
    const buildId = 3;
    const buildIdStr = '3';
    const mockJob = {};
    const mockFunc = () => {};
    const mockQueue = 'queuename';
    const runningJobsPrefix = 'mockRunningJobsPrefix_';
    const waitingJobsPrefix = 'mockRunningJobsPrefix_';
    const key = `${runningJobsPrefix}${jobId}`;
    let blockedByKeys;
    let mockWorker;
    let mockArgs;
    let mockRedis;
    let BlockedBy;
    let blockedBy;
    let mockRedisConfig;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach(() => {
        mockArgs = [{
            jobId,
            buildId,
            blockedBy: '111,222,777'
        }];
        blockedByKeys = [
            `${runningJobsPrefix}111`, `${runningJobsPrefix}222`, `${runningJobsPrefix}777`];

        mockRedis = {
            mget: sinon.stub().resolves([null, null]),
            set: sinon.stub().resolves(),
            expire: sinon.stub().resolves(),
            llen: sinon.stub().resolves(0),
            lpop: sinon.stub().resolves(),
            lrange: sinon.stub().resolves(['4', '5']),
            rpush: sinon.stub().resolves(),
            del: sinon.stub().resolves(),
            lrem: sinon.stub().resolves()
        };
        mockWorker = {
            queueObject: {
                connection: {
                    redis: mockRedis
                },
                enqueueIn: sinon.stub().resolves()
            }
        };
        mockRedisConfig = {
            runningJobsPrefix,
            waitingJobsPrefix
        };

        mockery.registerMock('ioredis', mockRedis);
        mockery.registerMock('../config/redis', mockRedisConfig);

        // eslint-disable-next-line global-require
        BlockedBy = require('../lib/BlockedBy.js').BlockedBy;

        blockedBy = new BlockedBy(mockWorker, mockFunc, mockQueue, mockJob, mockArgs, {
            blockedBySelf: true });
    });

    afterEach(() => {
        mockery.deregisterAll();
        mockery.resetCache();
    });

    after(() => {
        mockery.disable();
    });

    describe('BlockedBy', () => {
        it('constructor', async () => {
            assert.equal(blockedBy.name, 'BlockedBy');
        });

        describe('beforePerform', () => {
            it('proceeds if not blocked', async () => {
                mockRedis.lrange.resolves([]);
                await blockedBy.beforePerform();
                assert.calledWith(mockRedis.mget, blockedByKeys);
                assert.calledWith(mockRedis.set, key, buildId);
                assert.calledWith(mockRedis.expire, key, DEFAULT_BLOCKTIMEOUT * 60);
                assert.notCalled(mockWorker.queueObject.enqueueIn);
            });

            it('proceeds if not blocked by self and others', async () => {
                mockRedis.lrange.resolves([]);
                mockArgs[0].blockedBy = '777';
                blockedBy = new BlockedBy(mockWorker, mockFunc, mockQueue, mockJob, mockArgs, {
                    blockedBySelf: 'false'
                });
                await blockedBy.beforePerform();
                assert.notCalled(mockRedis.mget);
                assert.calledWith(mockRedis.set, key, buildId);
                assert.calledWith(mockRedis.expire, key, DEFAULT_BLOCKTIMEOUT * 60);
                assert.notCalled(mockWorker.queueObject.enqueueIn);
            });

            it('do not block by self', async () => {
                mockRedis.lrange.resolves([]);
                blockedBy = new BlockedBy(mockWorker, mockFunc, mockQueue, mockJob, mockArgs, {
                    blockedBySelf: 'false'
                });
                blockedByKeys = [`${runningJobsPrefix}111`, `${runningJobsPrefix}222`];

                await blockedBy.beforePerform();
                assert.calledWith(mockRedis.mget, blockedByKeys);
                assert.calledWith(mockRedis.set, key, buildId);
                assert.calledWith(mockRedis.expire, key, DEFAULT_BLOCKTIMEOUT * 60);
                assert.notCalled(mockWorker.queueObject.enqueueIn);
            });

            it('re-enqueue if blocked', async () => {
                mockRedis.mget.resolves(['', null]);
                await blockedBy.beforePerform();
                assert.calledWith(mockRedis.mget, blockedByKeys);
                assert.notCalled(mockRedis.set);
                assert.notCalled(mockRedis.expire);
                assert.calledWith(mockRedis.rpush,
                    `${waitingJobsPrefix}${jobId}`, buildId);
                assert.calledWith(mockWorker.queueObject.enqueueIn,
                    DEFAULT_ENQUEUETIME * 1000 * 60, mockQueue, mockFunc, mockArgs);
            });

            it('re-enqueue if blocked and not push to list if duplicate', async () => {
                mockRedis.mget.resolves(['', null]);
                mockRedis.lrange.resolves([buildIdStr]);
                await blockedBy.beforePerform();
                assert.calledWith(mockRedis.mget, blockedByKeys);
                assert.notCalled(mockRedis.set);
                assert.notCalled(mockRedis.expire);
                assert.notCalled(mockRedis.rpush);
                assert.calledWith(mockWorker.queueObject.enqueueIn,
                    DEFAULT_ENQUEUETIME * 1000 * 60, mockQueue, mockFunc, mockArgs);
            });

            it('proceeds if same job waiting but not same buildId and feature is off', async () => {
                mockRedis.lrange.resolves(['2']);
                mockRedis.llen.resolves(1);
                blockedBy = new BlockedBy(mockWorker, mockFunc, mockQueue, mockJob, mockArgs, {
                    blockedBySelf: 'false'
                });
                blockedByKeys = [`${runningJobsPrefix}111`, `${runningJobsPrefix}222`];
                await blockedBy.beforePerform();
                assert.calledWith(mockRedis.mget, blockedByKeys);
                assert.calledWith(mockRedis.mget, blockedByKeys);
                assert.calledWith(mockRedis.set, key, buildId);
                assert.calledWith(mockRedis.expire, key, DEFAULT_BLOCKTIMEOUT * 60);
                assert.notCalled(mockWorker.queueObject.enqueueIn);
                assert.notCalled(mockRedis.rpush);
                assert.notCalled(mockWorker.queueObject.enqueueIn);
            });

            it('re-enqueue if there is the same job waiting but not the same buildId', async () => {
                mockRedis.lrange.resolves(['2']);
                mockRedis.llen.resolves(1);
                await blockedBy.beforePerform();
                assert.calledWith(mockRedis.mget, blockedByKeys);
                assert.notCalled(mockRedis.set);
                assert.notCalled(mockRedis.expire);
                assert.calledWith(mockRedis.rpush,
                    `${waitingJobsPrefix}${jobId}`, buildId);
                assert.calledWith(mockWorker.queueObject.enqueueIn,
                    DEFAULT_ENQUEUETIME * 1000 * 60, mockQueue, mockFunc, mockArgs);
            });

            it('proceeds if there is the same job waiting with same buildId', async () => {
                mockRedis.lrange.resolves(['5', '3', '4']);
                mockRedis.llen.resolves(2);
                await blockedBy.beforePerform();
                assert.calledWith(mockRedis.mget, blockedByKeys);
                assert.calledWith(mockRedis.set, key, buildId);
                assert.calledWith(mockRedis.expire, key, DEFAULT_BLOCKTIMEOUT * 60);
                assert.notCalled(mockWorker.queueObject.enqueueIn);
            });

            it('delete key if is the last job waiting', async () => {
                mockRedis.lrange.resolves(['3']);
                mockRedis.llen.resolves(0);
                await blockedBy.beforePerform();
                assert.calledWith(mockRedis.mget, blockedByKeys);
                assert.calledWith(mockRedis.set, key, buildId);
                assert.calledWith(mockRedis.lrem, `${waitingJobsPrefix}${jobId}`, 0, 3);
                assert.calledWith(mockRedis.del, `${waitingJobsPrefix}${jobId}`);
                assert.calledWith(mockRedis.expire, key, DEFAULT_BLOCKTIMEOUT * 60);
                assert.notCalled(mockWorker.queueObject.enqueueIn);
            });

            it('use lockTimeout option for expiring key', async () => {
                mockRedis.lrange.resolves([]);
                const blockTimeout = 1;

                blockedBy = new BlockedBy(mockWorker, mockFunc, mockQueue, mockJob, mockArgs, {
                    blockTimeout
                });

                await blockedBy.beforePerform();
                assert.calledWith(mockRedis.expire, key, 60);
            });

            it('use reenqueueWaitTime option for enqueueing', async () => {
                const reenqueueWaitTime = 5;

                mockRedis.mget.resolves([true, null]);
                blockedBy = new BlockedBy(mockWorker, mockFunc, mockQueue, mockJob, mockArgs, {
                    reenqueueWaitTime
                });

                await blockedBy.beforePerform();
                assert.calledWith(mockWorker.queueObject.enqueueIn,
                    300000, mockQueue, mockFunc, mockArgs);
            });
        });

        describe('afterPerform', () => {
            it('proceeds', async () => {
                const proceed = await blockedBy.afterPerform();

                assert.equal(proceed, true);
            });
        });
    });
});
