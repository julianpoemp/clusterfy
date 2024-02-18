export class ClusterfyConnection {
  get options(): any {
    return this._options;
  }
  get type(): "message" | "os-socket" | "tcp-socket" {
    return this._type;
  }
  protected _type: "message" | "os-socket" | "tcp-socket";

  protected _options: any;
  constructor(options: any) {
    this._options = options;
  }

  async connect() {
  }

  destroy(){}
}
