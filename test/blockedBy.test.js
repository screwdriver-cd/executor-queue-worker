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
    const mockArgs = [{
        jobId,
        buildId,
        blockedBy: '111,222'
    }];
    const mockJob = {};
    const mockFunc = () => {};
    const mockQueue = 'queuename';
    const runningJobsPrefix = 'mockRunningJobsPrefix_';
    const waitingJobsPrefix = 'mockRunningJobsPrefix_';
    const key = `${runningJobsPrefix}${jobId}`;
    const blockedByKeys = [`${runningJobsPrefix}111`, `${runningJobsPrefix}222`];
    let mockWorker;
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
        mockRedis = {
            mget: sinon.stub().resolves([null, null]),
            set: sinon.stub().resolves(),
            expire: sinon.stub().resolves(),
            llen: sinon.stub().resolves(0),
            lpop: sinon.stub().resolves(),
            lindex: sinon.stub().resolves(buildIdStr), // first build waiting
            lrange: sinon.stub().resolves(['4', '5']),
            rpush: sinon.stub().resolves(),
            del: sinon.stub().resolves()
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

        blockedBy = new BlockedBy(mockWorker, mockFunc, mockQueue, mockJob, mockArgs, {});
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
                await blockedBy.beforePerform();
                assert.calledWith(mockRedis.mget, blockedByKeys);
                assert.calledWith(mockRedis.set, key, '');
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

            it('re-enqueue if there is the same job waiting but not the same buildId', async () => {
                mockRedis.llen.resolves(2);
                mockRedis.lindex.resolves('2');
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
                mockRedis.llen.resolves(2);
                mockRedis.lindex.resolves('3');
                await blockedBy.beforePerform();
                assert.calledWith(mockRedis.mget, blockedByKeys);
                assert.calledWith(mockRedis.set, key, '');
                assert.calledWith(mockRedis.expire, key, DEFAULT_BLOCKTIMEOUT * 60);
                assert.notCalled(mockWorker.queueObject.enqueueIn);
            });

            it('delete key if is the last job waiting', async () => {
                mockRedis.lindex.resolves('3');
                mockRedis.llen.onCall(0).resolves(1);
                mockRedis.llen.onCall(1).resolves(0);
                await blockedBy.beforePerform();
                assert.calledWith(mockRedis.mget, blockedByKeys);
                assert.calledWith(mockRedis.set, key, '');
                assert.calledWith(mockRedis.lpop, `${waitingJobsPrefix}${jobId}`);
                assert.calledWith(mockRedis.del, `${waitingJobsPrefix}${jobId}`);
                assert.calledWith(mockRedis.expire, key, DEFAULT_BLOCKTIMEOUT * 60);
                assert.notCalled(mockWorker.queueObject.enqueueIn);
            });

            it('use lockTimeout option for expiring key', async () => {
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
