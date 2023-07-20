export type ParcelMsg = { id: number; msg: any };
export type ParcelError = { id: number; error: string };
export type Parcel = ParcelMsg | ParcelError;

export type PendingParcel = {
  parcel: ParcelMsg;
  resolve: (response: any) => void;
  reject: (error: Error) => void;
};

// PostParcel never throws
export type PostParcel = (parcel: Parcel) => Promise<boolean>;
export type MessageHandler = (msg: any) => Promise<any>;

export default class Bus {
  private pendingParcels: Map<number, PendingParcel> = new Map();
  private idCounter: number = 1;

  constructor(private postParcel: PostParcel, private onMessage: MessageHandler) {}

  async handleParcel(parcel: Parcel) {
    const pendingParcel = this.pendingParcels.get(parcel.id);
    if (pendingParcel) {
      // parcel is a response
      this.pendingParcels.delete(parcel.id);
      if ('msg' in parcel) {
        pendingParcel.resolve(parcel.msg);
      } else {
        pendingParcel.reject(
          new Error(`Received error in response to ${JSON.stringify(pendingParcel.parcel.msg)}: ${parcel.error}`),
        );
      }
    } else {
      // parcel is new, call its handler and send back the response
      try {
        if (!('msg' in parcel)) throw new Error('parcel is missing msg');
        const msg = await this.onMessage(parcel.msg);
        await this.postParcel({ id: parcel.id, msg });
      } catch (error: any) {
        await this.postParcel({ id: parcel.id, error: error.message });
      }
    }
  }

  post(msg: any): Promise<any> {
    return new Promise(async (resolve, reject) => {
      const parcel = { id: this.idCounter++, msg };
      if (await this.postParcel(parcel)) {
        const pendingParcel = { parcel, resolve, reject };
        this.pendingParcels.set(parcel.id, pendingParcel);
      } else {
        reject(new Error('Could not send message'));
      }
    });
  }
}
