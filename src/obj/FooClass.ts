export class FooClass {
    constructor(private something: number) {
        console.log(`something is ${something}!`);
    }

    public fooFunction(other: number) {
        return this.something + other;
    }
}
