'use strict';

const assert = require('chai').assert;
const mockery = require('mockery');
const sinon = require('sinon');

sinon.assert.expose(assert, { prefix: '' });

describe('Plugin Test', () => {
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
        mockRedis = sinon.stub().returns({
            set: sinon.stub().resolves()
        });

        mockery.registerMock('ioredis', mockRedis);

        // eslint-disable-next-line global-require
        BlockedBy = require('../lib/BlockedBy.js');

        blockedBy = new BlockedBy();
    });

    afterEach(() => {
        mockery.deregisterAll();
        mockery.resetCache();
    });

    after(() => {
        mockery.disable();
    });

    describe('jobLock', () => {
        it('set the current jobid if not blocked', async () => {
            await blockedBy.beforePerform({ buildId: 1234, jobId: 777 }, (err, result) => {
                assert.isNull(err);
                assert.isNull(result);
                assert.calledWith(mockRedis.set, '777');
            });
        });
    });
});
