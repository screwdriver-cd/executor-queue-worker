'use strict';

const assert = require('chai').assert;
const EventEmitter = require('events').EventEmitter;
const mockery = require('mockery');
const sinon = require('sinon');
const util = require('util');

sinon.assert.expose(assert, { prefix: '' });

describe('index test', () => {
    let executorMockClass;
    let executorMock;
    let multiWorker;
    let nrMockClass;
    let winstonMock;
    let config;
    let index;
    let jobs;
    let testWorker;

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

        mockery.registerMock('screwdriver-executor-router', executorMockClass);
        mockery.registerMock('node-resque', nrMockClass);
        mockery.registerMock('winston', winstonMock);

        // eslint-disable-next-line global-require
        index = require('../index.js');
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
            assert.equal(err.message, 'fails to start');
        });
    });

    it('log the correct message', () => {
        const workerId = 1;
        const worker = 'abc';
        const pid = '111';
        const job = { args: { token: 'fake' } };
        const queue = 'testbuilds';
        const plugin = {};
        const result = 'result';
        const failure = 'failed';
        const error = 'error';
        const verb = '+';
        const delay = '3ms';

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

        testWorker.emit('failure', workerId, queue, job, failure);
        assert.calledWith(winstonMock.error,
            `worker[${workerId}] ${job} failure ${queue} ${JSON.stringify(job)} >> ${failure}`);

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
