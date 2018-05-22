'use strict';

const NodeResque = require('node-resque');
const { runningJobsPrefix } = require('../config/redis');

class BlockedBy extends NodeResque.Plugin {
    /**
     * Checks if there are any blocking jobs running. If yes, re-enqueue
     * If no, set the current job ID as key
     * @method beforePerform
     * @return {Promise}
     */
    async beforePerform() {
        const jobId = this.args[0].jobId;
        const blockedBy = this.args[0].blockedBy.split(',').map(jid =>
            `${runningJobsPrefix}${jid}`);
        const blockingJobKeys = await this.queueObject.connection.redis.mget(blockedBy);
        const blockingJobsRunning = blockingJobKeys.some(j => j !== null);
        const key = `${runningJobsPrefix}${jobId}`;

        // If any blocking job is running, then re-enqueue
        if (blockingJobsRunning) {
            await this.reEnqueue();

            return false;
        }

        // Register the curent job as running by setting key
        // Set expire time to take care of the case where
        // afterPerform failed to call and blocked jobs will be stuck forever
        await this.queueObject.connection.redis.set(key, '');
        await this.queueObject.connection.redis.expire(key, this.blockTimeout() * 60);

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
    async reEnqueue() {
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
