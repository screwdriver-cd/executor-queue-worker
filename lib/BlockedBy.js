'use strict';

const NodeResque = require('node-resque');
const { runningJobsPrefix, waitingJobsPrefix } = require('../config/redis');

class BlockedBy extends NodeResque.Plugin {
    /**
     * Checks if there are any blocking jobs running. If yes, re-enqueue
     * If no, set the current job ID as key
     * @method beforePerform
     * @return {Promise}
     */
    async beforePerform() {
        const { jobId, buildId } = this.args[0];
        const runningKey = `${runningJobsPrefix}${jobId}`;
        const waitingKey = `${waitingJobsPrefix}${jobId}`;
        const blockedBy = this.args[0].blockedBy.split(',').map(jid =>
            `${runningJobsPrefix}${jid}`);
        const blockingJobKeys = await this.queueObject.connection.redis.mget(blockedBy);
        const blockingJobsRunning = blockingJobKeys.some(j => j !== null);
        const sameJobWaiting = await this.queueObject.connection.redis.llen(waitingKey);

        // If any blocking job is running, then re-enqueue
        if (blockingJobsRunning) {
            await this.reEnqueue(waitingKey, buildId);

            return false;
        }

        // If not blocking, but the same job is already waiting
        if (sameJobWaiting > 0) {
            // get the first build that is waiting
            let firstWaitingBuild = await this.queueObject.connection.redis.lindex(waitingKey, 0);

            firstWaitingBuild = parseInt(firstWaitingBuild, 10);

            // if it's not the first build waiting, then re-enqueue
            if (firstWaitingBuild !== buildId) {
                await this.reEnqueue(waitingKey, buildId);

                return false;
            }
        }

        // Proceed to run build
        // Pop the first waiting build
        await this.queueObject.connection.redis.lpop(waitingKey);

        // Delete the waiting key
        if (sameJobWaiting === 1) {
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
    async reEnqueue(waitingKey, buildId) {
        // Add the current buildId to the waiting list of this job
        // Looks like jobID: buildID buildID buildID
        await this.queueObject.connection.redis.rpush(waitingKey, buildId);
        // enqueueIn uses milliseconds
        await this.queueObject.enqueueIn(
            this.reenqueueWaitTime() * 1000 * 60, this.queue, this.func, this.args);
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

        return 2; // in minutes
    }
}

exports.BlockedBy = BlockedBy;
