import { Slip10RawIndex } from "@iov/crypto";
import { KeyringEntryImplementationIdString, LocalIdentity } from "../keyring";
import { Slip10KeyringEntry } from "./slip10";
export declare class Ed25519HdWallet extends Slip10KeyringEntry {
    static fromEntropy(bip39Entropy: Uint8Array): Ed25519HdWallet;
    static fromMnemonic(mnemonicString: string): Ed25519HdWallet;
    readonly implementationId: KeyringEntryImplementationIdString;
    createIdentity(path?: ReadonlyArray<Slip10RawIndex>): Promise<LocalIdentity>;
    clone(): Ed25519HdWallet;
}
