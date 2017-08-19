'use strict';

const assert = require('chai').assert;
const EventEmitter = require('events').EventEmitter;
const mockery = require('mockery');
const sinon = require('sinon');
const util = require('util');

sinon.assert.expose(assert, { prefix: '' });

describe('Index Test', () => {
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
        method: 'PUT',
        payload: { status: 'FAILURE' },
        uri: `${job.args[0].apiUri}/v4/builds/${job.args[0].buildId}`
    };

    let mockJobs;
    let multiWorker;
    let nrMockClass;
    let spyMultiWorker;
    let winstonMock;
    let requestMock;
    let redisConfigMock;
    let index;
    let testWorker;
    let supportFunction;
    let updateBuildStatusMock;
    let processExitMock;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach(() => {
        mockJobs = {
            start: sinon.stub()
        };
        multiWorker = function () {
            this.start = () => {};
            this.end = sinon.stub();
        };
        util.inherits(multiWorker, EventEmitter);
        nrMockClass = {
            multiWorker
        };
        spyMultiWorker = sinon.spy(nrMockClass, 'multiWorker');
        winstonMock = {
            info: sinon.stub(),
            error: sinon.stub()
        };
        requestMock = sinon.stub();
        updateBuildStatusMock = sinon.stub();
        processExitMock = sinon.stub();
        process.exit = processExitMock;
        redisConfigMock = {
            connectionDetails: 'mockRedisConfig',
            queuePrefix: 'mockQueuePrefix_'
        };

        mockery.registerMock('./lib/jobs', mockJobs);
        mockery.registerMock('node-resque', nrMockClass);
        mockery.registerMock('winston', winstonMock);
        mockery.registerMock('request', requestMock);
        mockery.registerMock('./config/redis', redisConfigMock);

        // eslint-disable-next-line global-require
        index = require('../index.js');
        supportFunction = index.supportFunction;
        testWorker = index.multiWorker;
    });

    afterEach(() => {
        mockery.deregisterAll();
        mockery.resetCache();
        process.removeAllListeners('SIGTERM');
    });

    after(() => {
        mockery.disable();
    });

    describe('supportFunction', () => {
        it('logs correct message when successfully update build failure status', (done) => {
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

        it('logs correct message when fail to update build failure status', (done) => {
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

        it('logs error and exit with non-zero code when it fails to end worker', (done) => {
            const expectedErr = new Error('failed');

            testWorker.end.callsArgWith(0, expectedErr);

            supportFunction.shutDownWorker(testWorker);
            assert.calledWith(winstonMock.error, `failed to end the worker: ${expectedErr}`);
            assert.calledWith(processExitMock, 128);
            done();
        });

        it('exit with 0 when it successfully ends worker', (done) => {
            testWorker.end.callsArgWith(0, null);

            supportFunction.shutDownWorker(testWorker);
            assert.calledWith(processExitMock, 0);
            done();
        });
    });

    describe('event handler', () => {
        it('logs the correct message', () => {
            testWorker.emit('start', workerId);
            assert.calledWith(winstonMock.info, `worker[${workerId}] started`);

            testWorker.emit('end', workerId);
            assert.calledWith(winstonMock.info, `worker[${workerId}] ended`);

            testWorker.emit('cleaning_worker', workerId, worker, pid);
            assert.calledWith(winstonMock.info, `cleaning old worker ${worker} pid ${pid}`);

            testWorker.emit('poll', workerId, queue);
            assert.calledWith(winstonMock.info, `worker[${workerId}] polling ${queue}`);

            testWorker.emit('job', workerId, queue, job);
            assert.calledWith(winstonMock.info,
                `worker[${workerId}] working job ${queue} ${JSON.stringify(job)}`);

            testWorker.emit('reEnqueue', workerId, queue, job, plugin);
            assert.calledWith(winstonMock.info,
                `worker[${workerId}] reEnqueue job (${plugin}) ${queue} ${JSON.stringify(job)}`);

            testWorker.emit('success', workerId, queue, job, result);
            assert.calledWith(winstonMock.info,
                `worker[${workerId}] ${job} success ${queue} ${JSON.stringify(job)} >> ${result}`);

            // Mock updateBuildStatus to assert params pass in for the function
            index.supportFunction.updateBuildStatus = updateBuildStatusMock;
            testWorker.emit('failure', workerId, queue, job, failure);
            assert.calledWith(updateBuildStatusMock, updateConfig);

            testWorker.emit('error', workerId, queue, job, error);
            assert.calledWith(winstonMock.error,
                `worker[${workerId}] error ${queue} ${JSON.stringify(job)} >> ${error}`);

            testWorker.emit('pause', workerId);
            assert.calledWith(winstonMock.info, `worker[${workerId}] paused`);

            testWorker.emit('internalError', error);
            assert.calledWith(winstonMock.error, error);

            testWorker.emit('multiWorkerAction', verb, delay);
            assert.calledWith(winstonMock.info,
                `*** checked for worker status: ${verb} (event loop delay: ${delay}ms)`);
        });
    });

    describe('multiWorker', () => {
        it('is constructed correctly', () => {
            const expectedConfig = {
                connection: 'mockRedisConfig',
                queues: ['mockQueuePrefix_builds'],
                minTaskProcessors: 1,
                maxTaskProcessors: 10,
                checkTimeout: 1000,
                maxEventLoopDelay: 10,
                toDisconnectProcessors: true
            };

            assert.calledWith(spyMultiWorker, sinon.match(expectedConfig), sinon.match({
                start: mockJobs.start
            }));
        });

        it('shuts down worker when received SIGTERM signal', (done) => {
            const shutDownWorkerMock = sinon.stub();

            index.supportFunction.shutDownWorker = shutDownWorkerMock;

            process.once('SIGTERM', () => {
                assert.calledOnce(shutDownWorkerMock);
                done();
            });
            process.kill(process.pid, 'SIGTERM');
        });
    });
});
