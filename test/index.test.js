'use strict';

const assert = require('chai').assert;
const EventEmitter = require('events').EventEmitter;
const mockery = require('mockery');
const sinon = require('sinon');
const util = require('util');

sinon.assert.expose(assert, { prefix: '' });

describe('index test', () => {
    const worker = 'abc';
    const pid = '111';
    const plugin = {};
    const result = 'result';
    const error = 'error';
    const verb = '+';
    const delay = '3ms';
    const workerId = 1;
    const job = { args: [{ token: 'fake', buildId: 1, apiUri: 'foo.bar' }] };
    const queue = 'testbuilds';
    const failure = 'failed';
    const updateConfig = { job, queue, workerId, failure };
    const requestOptions = {
        auth: { bearer: job.args[0].token },
        json: true,
        method: 'POST',
        payload: { status: 'FAILURE' },
        uri: `${job.args[0].apiUri}/v4/builds/${job.args[0].buildId}`
    };

    let executorMockClass;
    let executorMock;
    let multiWorker;
    let nrMockClass;
    let winstonMock;
    let requestMock;
    let config;
    let index;
    let jobs;
    let testWorker;
    let supportFunction;
    let updateBuildStatusMock;

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
        multiWorker = class { start() {} };
        util.inherits(multiWorker, EventEmitter);
        nrMockClass = {
            multiWorker
        };
        winstonMock = {
            log: sinon.stub(),
            error: sinon.stub()
        };
        executorMockClass = sinon.stub().returns(executorMock);
        requestMock = sinon.stub();
        updateBuildStatusMock = sinon.stub();

        mockery.registerMock('screwdriver-executor-router', executorMockClass);
        mockery.registerMock('node-resque', nrMockClass);
        mockery.registerMock('winston', winstonMock);
        mockery.registerMock('request', requestMock);

        // eslint-disable-next-line global-require
        index = require('../index.js');
        supportFunction = index.supportFunction;
        jobs = index.jobs;
        testWorker = index.multiWorker;

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
            assert.strictEqual(err.message, 'fails to start');
        });
    });

    it('log correct message when successfully update build failure status', (done) => {
        requestMock.yieldsAsync(null, { statusCode: 200 });

        supportFunction.updateBuildStatus(updateConfig, (err) => {
            assert.calledWith(requestMock, requestOptions);
            assert.isNull(err);
            assert.calledWith(winstonMock.error,
            // eslint-disable-next-line max-len
                `worker[${workerId}] ${job} failure ${queue} ${JSON.stringify(job)} >> successfully update build status: ${failure}`
            );
            done();
        });
    });

    it('log correct message when fail to update build failure status', (done) => {
        const requestErr = new Error('failed to update');
        const response = {};

        requestMock.yieldsAsync(requestErr, response);

        supportFunction.updateBuildStatus(updateConfig, (err) => {
            assert.calledWith(requestMock, requestOptions);
            assert.strictEqual(err.message, 'failed to update');
            assert.calledWith(winstonMock.error,
                // eslint-disable-next-line max-len
                `worker[${workerId}] ${job} failure ${queue} ${JSON.stringify(job)} >> ${failure} ${requestErr} ${response}`
            );
            done();
        });
    });

    it('log the correct message', () => {
        testWorker.emit('start', workerId);
        assert.calledWith(winstonMock.log, `worker[${workerId}] started`);

        testWorker.emit('end', workerId);
        assert.calledWith(winstonMock.log, `worker[${workerId}] ended`);

        testWorker.emit('cleaning_worker', workerId, worker, pid);
        assert.calledWith(winstonMock.log, `cleaning old worker ${worker} pid ${pid}`);

        testWorker.emit('poll', workerId, queue);
        assert.calledWith(winstonMock.log, `worker[${workerId}] polling ${queue}`);

        testWorker.emit('job', workerId, queue, job);
        assert.calledWith(winstonMock.log,
            `worker[${workerId}] working job ${queue} ${JSON.stringify(job)}}`);

        testWorker.emit('reEnqueue', workerId, queue, job, plugin);
        assert.calledWith(winstonMock.log,
            `worker[${workerId}] reEnqueue job (${plugin}) ${queue} ${JSON.stringify(job)}`);

        testWorker.emit('success', workerId, queue, job, result);
        assert.calledWith(winstonMock.log,
            `worker[${workerId}] ${job} success ${queue} ${JSON.stringify(job)} >> ${result}`);

        // Mock updateBuildStatus to assert params pass in for the function
        index.supportFunction.updateBuildStatus = updateBuildStatusMock;
        testWorker.emit('failure', workerId, queue, job, failure);
        assert.calledWith(updateBuildStatusMock, updateConfig);

        testWorker.emit('error', workerId, queue, job, error);
        assert.calledWith(winstonMock.error,
            `worker[${workerId}] error ${queue} ${JSON.stringify(job)} >> ${error}`);

        testWorker.emit('pause', workerId);
        assert.calledWith(winstonMock.log, `worker[${workerId}] paused`);

        testWorker.emit('internalError', error);
        assert.calledWith(winstonMock.error, error);

        testWorker.emit('multiWorkerAction', verb, delay);
        assert.calledWith(winstonMock.log,
            `*** checked for worker status: ${verb} (event loop delay: ${delay}ms)`);
    });
});
