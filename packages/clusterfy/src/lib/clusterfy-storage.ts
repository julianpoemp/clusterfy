export class ClusterfyStorage<T> {
  private _snapshot: T;

  constructor(initState: T) {
    this._snapshot = initState;
  }

  save(path: string, value: any) {
    const splitted = this.readPath(path);
    this._snapshot = this.saveValueToObject(this._snapshot, value, splitted);
  }

  retrieve<S>(path: string): S {
    const splitted = this.readPath(path);
    return this.readValueFromObject(this._snapshot, splitted);
  }

  private readPath(path: string): string[] {
    if (!path) {
      throw new Error("Can't read path. Path must not be empty or undefined");
    }
    const splitted = path.split('.').filter((a) => a !== '' && a !== undefined);
    if (splitted.length === 0) {
      throw new Error(
        `Can't save value to ClusterfyStorage. Missing points in string.`
      );
    }

    return splitted;
  }

  private saveValueToObject(
    object: any,
    value: any,
    remaining: string[],
    processed: string[] = []
  ) {
    if (remaining.length === 0) {
      return object;
    }

    const attr = remaining[0];
    processed.push(attr);
    if (Object.keys(object).includes(attr) || remaining.length === 1) {
      if (remaining.length > 1) {
        object[attr] = this.saveValueToObject(
          object[attr],
          value,
          remaining.slice(1),
          processed
        );
      } else {
        object[attr] = value;
      }
    } else {
      throw new Error(
        `Can't save value to ClusterfyStorage. Key '${processed.join(
          '.'
        )}' does not exist.`
      );
    }

    return object;
  }

  private readValueFromObject(
    object: any,
    remaining: string[],
    processed: string[] = []
  ) {
    if (remaining.length === 0) {
      return object;
    }

    const attr = remaining[0];
    processed.push(attr);
    if (Object.keys(object).includes(attr) || remaining.length === 1) {
      if (remaining.length > 1) {
        return this.readValueFromObject(
          object[attr],
          remaining.slice(1),
          processed
        );
      } else {
        return object[attr];
      }
    } else {
      throw new Error(
        `Can't save value to ClusterfyStorage. Key '${processed.join(
          '.'
        )}' does not exist.`
      );
    }

    return object;
  }
}
