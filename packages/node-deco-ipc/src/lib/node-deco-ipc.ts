export function SharedStorageClassDecorator<T extends { new(...args: any[]): {} }>(constructor: T) {
    console.log("test ok")
    return class extends constructor {
        newProperty = "new property";
        hello = "override";
    }
}
