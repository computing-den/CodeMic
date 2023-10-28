export type ParcelMsg = { id: number; isResponse: boolean; msg: any };
export type ParcelError = { id: number; isResponse: boolean; error: string };
export type Parcel = ParcelMsg | ParcelError;

export type PendingParcel = {
  parcel: ParcelMsg;
  resolve: (response: any) => void;
  reject: (error: Error) => void;
};

// PostParcel never throws
export type PostParcel = (parcel: Parcel) => Promise<boolean>;
export type MessageHandler = (msg: any) => Promise<any>;

export class Bus {
  private pendingParcels: Map<number, PendingParcel> = new Map();
  private idCounter = 0;

  constructor(private postParcel: PostParcel, private onMessage: MessageHandler) {}

  async handleParcel(parcel: Parcel) {
    if (parcel.isResponse) {
      const pendingParcel = this.pendingParcels.get(parcel.id);
      if (!pendingParcel) {
        console.error(
          'Received a response but cannot find the corresponding request. This may happen due to vscode restarting after changing the first workspace folder. Response: ',
          JSON.stringify(parcel),
        );
        return;
      }

      this.pendingParcels.delete(parcel.id);
      if ('msg' in parcel) {
        pendingParcel.resolve(parcel.msg);
      } else {
        pendingParcel.reject(
          new Error(`Received error in response to ${JSON.stringify(pendingParcel.parcel.msg)}: ${parcel.error}`),
        );
      }
    } else {
      try {
        if (!('msg' in parcel)) throw new Error('parcel is missing msg');

        const msg = await this.onMessage(parcel.msg);
        await this.postParcel({ id: parcel.id, isResponse: true, msg });
      } catch (error: any) {
        console.error(error);
        await this.postParcel({ id: parcel.id, isResponse: true, error: error.message });
      }
    }
  }

  post(msg: any): Promise<any> {
    return new Promise(async (resolve, reject) => {
      const parcel = { id: ++this.idCounter, isResponse: false, msg };
      if (await this.postParcel(parcel)) {
        const pendingParcel = { parcel, resolve, reject };
        this.pendingParcels.set(parcel.id, pendingParcel);
      } else {
        reject(new Error('Could not send message'));
      }
    });
  }
}
