'use strict';

const NodeResque = require('node-resque');
const { runningJobsPrefix, waitingJobsPrefix } = require('../config/redis');

/**
 * Handle blocked by itself
 * @method blockedBySelf
 * @param  {String}      waitingKey     ${waitingJobsPrefix}${jobId}
 * @param  {String}      buildId        Current buildId
 * @return {Boolean}                    Whether this build is blocked
 */
async function blockedBySelf({ waitingKey, buildId }) {
    let waitingBuilds = await this.queueObject.connection.redis.lrange(waitingKey, 0, -1);
    // Only need to do this if there are waiting builds.
    // If it's not the first build waiting, then re-enqueue

    if (waitingBuilds.length > 0) {
        waitingBuilds = waitingBuilds.map(bId => parseInt(bId, 10));
        waitingBuilds.sort((a, b) => a - b);

        // Get the first build that is waiting
        const firstWaitingBuild = waitingBuilds[0];

        if (firstWaitingBuild !== buildId) {
            await this.reEnqueue(waitingKey, buildId);

            return true; // blocked
        }

        // If is the first waiting build, remove it and proceed
        await this.queueObject.connection.redis.lrem(waitingKey, 0, firstWaitingBuild);

        // Get the waiting jobs again - to prevent race condition where this value is changed in between
        const sameJobWaiting = await this.queueObject.connection.redis.llen(waitingKey);

        // Remove the waiting key
        if (sameJobWaiting === 0) {
            await this.queueObject.connection.redis.del(waitingKey);
        }
    }

    return false;
}
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
        const deleteKey = `deleted_${jobId}_${buildId}`;
        const enforceBlockedBySelf = String(this.options.blockedBySelf) === 'true'; // because kubernetes value is a string
        const shouldDelete = await this.queueObject.connection.redis.get(deleteKey);

        // If this build is in the delete list (it was aborted)
        if (shouldDelete !== null) {
            await this.queueObject.connection.redis.del(deleteKey);

            //  Clean up to prevent race condition: stop and beforePerform happen at the same time
            //  stop deletes key runningKey and waitingKey
            //  beforePerform either proceeds or reEnqueue (which adds the key back)
            await this.queueObject.connection.redis.lrem(waitingKey, 0, buildId);
            const runningBuildId = await this.queueObject.connection.redis.get(runningKey);

            if (parseInt(runningBuildId, 10) === buildId) {
                await this.queueObject.connection.redis.del(runningKey);
            }

            // Should not proceed since this build was previously aborted
            return false;
        }

        let blockedBy = this.args[0].blockedBy.split(',').map(jid =>
            `${runningJobsPrefix}${jid}`);

        if (!enforceBlockedBySelf) {
            blockedBy = blockedBy.filter(key => key !== `${runningJobsPrefix}${jobId}`); // remove itself from blocking list
        }

        if (blockedBy.length > 0) {
            const blockingJobsRunning = [];

            // Get the blocking job
            await Promise.all(blockedBy.map(async (key) => {
                const val = await this.queueObject.connection.redis.get(key);

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
        }

        if (enforceBlockedBySelf) { // only check this if feature is on
            const blocked = await blockedBySelf.call(this, { // pass in this context
                waitingKey,
                buildId
            });

            if (blocked) { return false; } // if blocked then cannot proceed
        } else { // clean up waitingKey
            await this.queueObject.connection.redis.del(waitingKey);
        }

        // Register the curent job as running by setting key
        await this.queueObject.connection.redis.set(runningKey, buildId);

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
