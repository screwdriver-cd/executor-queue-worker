'use strict';

const assert = require('chai').assert;
const mockery = require('mockery');
const sinon = require('sinon');

sinon.assert.expose(assert, { prefix: '' });

describe('Helper Test', () => {
    const job = { args: [{ buildId: 1 }] };
    const status = 'BLOCKED';
    const statusMessage = 'blocked by these bloking jobs: 123, 456';
    const requestOptions = {
        auth: { bearer: 'fake' },
        json: true,
        method: 'PUT',
        body: {
            status,
            statusMessage
        },
        uri: `foo.bar/v4/builds/${job.args[0].buildId}`
    };
    let mockRequest;
    let mockRedis;
    let mockRedisConfig;
    let helper;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach(() => {
        mockRequest = sinon.stub();
        mockRedis = { hget: sinon.stub().resolves('{"apiUri": "foo.bar", "token": "fake"}') };

        mockRedisConfig = {
            queuePrefix: 'mockQueuePrefix_'
        };

        mockery.registerMock('request', mockRequest);
        mockery.registerMock('../config/redis', mockRedisConfig);

        // eslint-disable-next-line global-require
        helper = require('../lib/helper.js');
    });

    afterEach(() => {
        mockery.deregisterAll();
        mockery.resetCache();
        process.removeAllListeners('SIGTERM');
    });

    after(() => {
        mockery.disable();
    });

    it('logs correct message when successfully update build failure status', (done) => {
        mockRequest.yieldsAsync(null, { statusCode: 200 });

        helper.updateBuildStatus({
            redisInstance: mockRedis,
            status,
            statusMessage,
            buildId: 1
        }, (err) => {
            assert.calledWith(mockRedis.hget,
                'mockQueuePrefix_buildConfigs', job.args[0].buildId);
            assert.calledWith(mockRequest, requestOptions);
            assert.isNull(err);
            done();
        });
    });

    it('logs correct message when fail to update build failure status', (done) => {
        const requestErr = new Error('failed to update');
        const response = {};

        mockRequest.yieldsAsync(requestErr, response);

        helper.updateBuildStatus({
            redisInstance: mockRedis,
            status,
            statusMessage,
            buildId: 1
        }, (err) => {
            assert.calledWith(mockRequest, requestOptions);
            assert.strictEqual(err.message, 'failed to update');
            done();
        });
    });
});
