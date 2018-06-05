'use strict';

const NodeResque = require('node-resque');
const { runningJobsPrefix, waitingJobsPrefix } = require('../config/redis');

class BlockedBy extends NodeResque.Plugin {
    /**
   * Construct a new BlockedBy plugin
   * @method constructor
   */
    constructor(worker, func, queue, job, args, options) {
        super(worker, func, queue, job, args, options);

        this.name = 'BlockedBy';
    }

    /**
     * Checks if there are any blocking jobs running.
     * If yes, re-enqueue. If no, check if there is the same job waiting.
     * If buildId is not the same, re-enqueue. Otherwise, proceeds and set the current job as running
     * @method beforePerform
     * @return {Promise}
     */
    async beforePerform() {
        const { jobId, buildId } = this.args[0];
        const runningKey = `${runningJobsPrefix}${jobId}`;
        const waitingKey = `${waitingJobsPrefix}${jobId}`;
        const blockedBy = this.args[0].blockedBy.split(',').map(jid =>
            `${runningJobsPrefix}${jid}`);
        const blockingJobsRunning = [];

        console.log(blockedBy);
        // Get the blocking job
        await Promise.all(blockedBy.map(async (key) => {
            const val = await this.queueObject.connection.redis.get(key);

            console.log(key);
            console.log(val);

            if (val !== null) {
                // eslint-disable-next-line
                const [, jid] = key.match(/mockRunningJobsPrefix_(\d*)/);

                blockingJobsRunning.push(jid);
            }
        }));

        // If any blocking job is running, then re-enqueue
        if (blockingJobsRunning.length > 0) {
            await this.reEnqueue(waitingKey, buildId, blockingJobsRunning);

            return false;
        }

        let sameJobWaiting = await this.queueObject.connection.redis.llen(waitingKey);

        // If not blocking, but the same job is already waiting
        if (sameJobWaiting > 0) {
            // get the first build that is waiting
            let firstWaitingBuild = await this.queueObject.connection.redis.lindex(waitingKey, 0);

            firstWaitingBuild = parseInt(firstWaitingBuild, 10);

            // if it's not the first build waiting, then re-enqueue
            if (firstWaitingBuild !== buildId) {
                await this.reEnqueue(waitingKey, buildId, [jobId]);

                return false;
            }
        }

        // Proceed to run build
        // Pop the first waiting build
        await this.queueObject.connection.redis.lpop(waitingKey);

        // Get the waiting jobs again - to prevent race condition where this value is changed in between
        sameJobWaiting = await this.queueObject.connection.redis.llen(waitingKey);
        if (sameJobWaiting === 0) {
            await this.queueObject.connection.redis.del(waitingKey);
        }

        // Register the curent job as running by setting key
        await this.queueObject.connection.redis.set(runningKey, '');

        // Set expire time to take care of the case where
        // afterPerform failed to call and blocked jobs will be stuck forever
        await this.queueObject.connection.redis.expire(runningKey, this.blockTimeout() * 60);

        // Proceed
        return true;
    }

    /**
     * Returns true to proceed
     * @method afterPerform
     * @return {Promise}
     */
    async afterPerform() {
        return true;
    }

    /**
     * Re-enqueue in "reenqueueWaitTime"
     * @method reEnqueue
     * @return {Promise}
     */
    async reEnqueue(waitingKey, buildId, blockingJobsRunning) {
        const buildsWaiting = await this.queueObject.connection.redis.lrange(waitingKey, 0, -1);
        const keyExist = buildsWaiting.some(key => parseInt(key, 10) === buildId);

        // Add the current buildId to the waiting list of this job
        // Looks like jobID: buildID buildID buildID
        if (!keyExist) {
            await this.queueObject.connection.redis.rpush(waitingKey, buildId);
        }

        // enqueueIn uses milliseconds
        await this.queueObject.enqueueIn(
            this.reenqueueWaitTime() * 1000 * 60, this.queue, this.func, this.args);

        // eslint-disable-next-line
        const { supportFunction } = require('../index.js');

        console.log(blockingJobsRunning);
        await supportFunction.updateBuildStatus({
            status: 'QUEUED',
            statusMessage: `Blocked by these running jobs: ${blockingJobsRunning}`
        }, () => {});
    }

    blockTimeout() { // same as build timeout
        if (this.options.blockTimeout) {
            return this.options.blockTimeout;
        }

        return 120; // in minutes
    }

    reenqueueWaitTime() {
        if (this.options.reenqueueWaitTime) {
            return this.options.reenqueueWaitTime;
        }

        return 1; // in minutes
    }
}

exports.BlockedBy = BlockedBy;
