// Renewal never waits for UI/file work. Every result is fenced to the exact
// connection, project, edit directory and epoch captured before the request.
export class LeaseHeartbeat {
  constructor({ capture, renew, accepted, failed }) {
    Object.assign(this, { capture, renew, accepted, failed });
    this.busy = false;
    this.stopped = false;
  }
  current(frozen) {
    const active = this.capture();
    return (
      !this.stopped &&
      active &&
      active.connection === frozen.connection &&
      active.project === frozen.project &&
      active.root === frozen.root &&
      active.epoch === frozen.epoch
    );
  }
  async tick() {
    if (this.stopped || this.busy) return;
    const frozen = this.capture();
    if (!frozen) return;
    this.busy = true;
    try {
      const latest = await this.renew(frozen);
      if (!this.current(frozen)) return;
      if (
        latest.epoch !== frozen.epoch ||
        latest.lease?.user !== frozen.connection.user ||
        !Number.isFinite(latest.serverNow) ||
        !(latest.lease.expires > latest.serverNow)
      )
        throw new Error("編集権の更新結果が現在のepochと一致しません");
      this.accepted(frozen, latest);
    } catch (error) {
      if (this.current(frozen)) this.failed(frozen, error);
    } finally {
      this.busy = false;
    }
  }
  start(interval = 3000) {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => void this.tick(), interval);
  }
  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = null;
  }
}
