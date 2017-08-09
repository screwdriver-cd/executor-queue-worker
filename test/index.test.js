'use strict';

const assert = require('chai').assert;
const mockery = require('mockery');
const sinon = require('sinon');
let jobs;

sinon.assert.expose(assert, { prefix: '' });

describe('index test', () => {
    let executorMockClass;
    let executorMock;
    let config;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach(() => {
        executorMock = {
            start: sinon.stub()
        };
        executorMockClass = sinon.stub().returns(executorMock);

        mockery.registerMock('screwdriver-executor-router', executorMockClass);

        // eslint-disable-next-line global-require
        jobs = require('../index.js').jobs;

        config = {
            buildId: 8609,
            container: 'node:6',
            apiUri: 'http://api.com',
            token: 'asdf',
            annotations: {
                'beta.screwdriver.cd/executor': 'k8s'
            }
        };
    });

    afterEach(() => {
        mockery.deregisterAll();
        mockery.resetCache();
    });

    after(() => {
        mockery.disable();
    });

    it('callback with null if start successfully', () => {
        executorMock.start.resolves(null);

        jobs.start.perform(config, (err) => {
            assert.calledWith(executorMock.start, config);
            assert.isNull(err);
        });
    });

    it('callback with error if executor fails to start', () => {
        executorMock.start.rejects(new Error('fails to start'));

        jobs.start.perform(config, (err) => {
            assert.equal(err.message, 'fails to start');
        });
    });
});
