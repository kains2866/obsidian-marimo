interface Writer {isClosed():boolean;onClose():Promise<void>}
export interface WriterLease {readonly key:string;readonly owner:Writer}

export class WriterLocks {
  private leases=new Map<string,WriterLease>();
  async claim(key:string,owner:Writer):Promise<WriterLease> {
    const previous=this.leases.get(key);
    if(previous&&previous.owner!==owner&&previous.owner.isClosed())await previous.owner.onClose();
    const current=this.leases.get(key);
    if(current&&current.owner!==owner)throw new Error('This file is already connected in another native view.');
    const lease={key,owner};this.leases.set(key,lease);return lease;
  }
  release(lease:WriterLease|null):void {
    if(lease&&this.leases.get(lease.key)===lease)this.leases.delete(lease.key);
  }
  owners():Writer[] {return [...new Set([...this.leases.values()].map(lease=>lease.owner))];}
}
