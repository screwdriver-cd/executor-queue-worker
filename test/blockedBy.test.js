'use strict';

const assert = require('chai').assert;
const mockery = require('mockery');
const sinon = require('sinon');

sinon.assert.expose(assert, { prefix: '' });

describe('Plugin Test', () => {
    const DEFAULT_LOCKTIMEOUT = 7200;
    const DEFAULT_ENQUEUETIME = 300;
    const blockedByIDs = [111, 222];
    const jobId = 777;
    const mockArgs = [{
        jobId,
        blockedBy: blockedByIDs
    }];
    const mockJob = {};
    const mockFunc = () => {};
    const mockQueue = 'queuename';
    let mockWorker;
    let mockRedis;
    let BlockedBy;
    let blockedBy;

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
            expire: sinon.stub().resolves()
        };
        mockWorker = {
            queueObject: {
                connection: {
                    redis: mockRedis
                },
                enqueueIn: sinon.stub().resolves()
            }
        };

        mockery.registerMock('ioredis', mockRedis);

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
        describe('beforePerform', () => {
            it('set the current jobid if not blocked', async () => {
                const key = `running_job_${jobId}`;

                await blockedBy.beforePerform();
                assert.calledWith(mockRedis.mget, blockedByIDs);
                assert.calledWith(mockRedis.set, key, true);
                assert.calledWith(mockRedis.expire, key, DEFAULT_LOCKTIMEOUT);
                assert.notCalled(mockWorker.queueObject.enqueueIn);
            });

            it('re-enqueue if blocked', async () => {
                mockRedis.mget.resolves([true, null]);
                await blockedBy.beforePerform();
                assert.calledWith(mockRedis.mget, blockedByIDs);
                assert.notCalled(mockRedis.set);
                assert.notCalled(mockRedis.expire);
                assert.calledWith(mockWorker.queueObject.enqueueIn,
                    DEFAULT_ENQUEUETIME * 1000, mockQueue, mockFunc, mockArgs);
            });

            it('use lockTimeout option for expiring key', async () => {
                const key = `running_job_${jobId}`;
                const lockTimeout = 60;

                blockedBy = new BlockedBy(mockWorker, mockFunc, mockQueue, mockJob, mockArgs, {
                    lockTimeout
                });

                await blockedBy.beforePerform();
                assert.calledWith(mockRedis.expire, key, lockTimeout);
            });

            it('use reenqueueWaitTime option for enqueueing', async () => {
                const reenqueueWaitTime = 120;

                mockRedis.mget.resolves([true, null]);
                blockedBy = new BlockedBy(mockWorker, mockFunc, mockQueue, mockJob, mockArgs, {
                    reenqueueWaitTime
                });

                await blockedBy.beforePerform();
                assert.calledWith(mockWorker.queueObject.enqueueIn,
                    reenqueueWaitTime * 1000, mockQueue, mockFunc, mockArgs);
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
