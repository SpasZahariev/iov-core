import { Address, BcpAccountQuery, SendTx, TokenTicker, TransactionKind } from "@iov/bcp-types";
import { Encoding } from "@iov/encoding";
import { Ed25519KeyringEntry } from "@iov/keycontrol";
import { ChainId } from "@iov/tendermint-types";

import { passphraseToKeypair } from "./derivation";
import { generateNonce, LiskClient } from "./liskclient";
import { liskCodec } from "./liskcodec";

function pendingWithoutLongRunning(): void {
  if (!process.env.LONG_RUNNING_ENABLED) {
    pending("Set LONG_RUNNING_ENABLED to enable long running tests");
  }
}

const liskTestnet = "da3ed6a45429278bac2666961289ca17ad86595d33b31037615d4b8e8f158bba" as ChainId;

describe("LiskClient", () => {
  const base = "https://testnet.lisk.io";

  it("can be constructed", () => {
    const client = new LiskClient(base, liskTestnet);
    expect(client).toBeTruthy();
  });

  it("takes different kind of API URLs", () => {
    expect(new LiskClient("http://localhost", liskTestnet)).toBeTruthy();
    expect(new LiskClient("http://localhost/", liskTestnet)).toBeTruthy();
    expect(new LiskClient("https://localhost", liskTestnet)).toBeTruthy();
    expect(new LiskClient("https://localhost/", liskTestnet)).toBeTruthy();
    expect(new LiskClient("http://localhost:456", liskTestnet)).toBeTruthy();
    expect(new LiskClient("http://localhost:456/", liskTestnet)).toBeTruthy();
    expect(new LiskClient("https://localhost:456", liskTestnet)).toBeTruthy();
    expect(new LiskClient("https://localhost:456/", liskTestnet)).toBeTruthy();

    expect(new LiskClient("http://my-HOST.tld", liskTestnet)).toBeTruthy();
    expect(new LiskClient("http://my-HOST.tld/", liskTestnet)).toBeTruthy();
    expect(new LiskClient("https://my-HOST.tld", liskTestnet)).toBeTruthy();
    expect(new LiskClient("https://my-HOST.tld/", liskTestnet)).toBeTruthy();
    expect(new LiskClient("http://my-HOST.tld:456", liskTestnet)).toBeTruthy();
    expect(new LiskClient("http://my-HOST.tld:456/", liskTestnet)).toBeTruthy();
    expect(new LiskClient("https://my-HOST.tld:456", liskTestnet)).toBeTruthy();
    expect(new LiskClient("https://my-HOST.tld:456/", liskTestnet)).toBeTruthy();

    expect(new LiskClient("http://123.123.123.123", liskTestnet)).toBeTruthy();
    expect(new LiskClient("http://123.123.123.123/", liskTestnet)).toBeTruthy();
    expect(new LiskClient("https://123.123.123.123", liskTestnet)).toBeTruthy();
    expect(new LiskClient("https://123.123.123.123/", liskTestnet)).toBeTruthy();
    expect(new LiskClient("http://123.123.123.123:456", liskTestnet)).toBeTruthy();
    expect(new LiskClient("http://123.123.123.123:456/", liskTestnet)).toBeTruthy();
    expect(new LiskClient("https://123.123.123.123:456", liskTestnet)).toBeTruthy();
    expect(new LiskClient("https://123.123.123.123:456/", liskTestnet)).toBeTruthy();
  });

  it("throws for invalid API URLs", () => {
    // wrong scheme
    expect(() => new LiskClient("localhost", liskTestnet)).toThrowError(/invalid api url/i);
    expect(() => new LiskClient("ftp://localhost", liskTestnet)).toThrowError(/invalid api url/i);
    expect(() => new LiskClient("ws://localhost", liskTestnet)).toThrowError(/invalid api url/i);

    // unsupported hosts
    expect(() => new LiskClient("http://[2001::0370:7344]/", liskTestnet)).toThrowError(/invalid api url/i);
    expect(() => new LiskClient("http://[2001::0370:7344]:8080/", liskTestnet)).toThrowError(
      /invalid api url/i,
    );

    // wrong path
    expect(() => new LiskClient("http://localhost/api", liskTestnet)).toThrowError(/invalid api url/i);
  });

  it("can disconnect", () => {
    const client = new LiskClient(base, liskTestnet);
    expect(() => client.disconnect()).not.toThrow();
  });

  it("can get chain ID", async () => {
    const client = await LiskClient.connect(base);
    const chainId = client.chainId();
    expect(chainId).toEqual(liskTestnet);
  });

  it("can get height", async () => {
    const client = await LiskClient.connect(base);
    const height = await client.height();
    expect(height).toBeGreaterThan(6000000);
    expect(height).toBeLessThan(8000000);
  });

  it("can get account", async () => {
    // Generate dead target address:
    // python3 -c 'import random; print("{}L".format(random.randint(0, 18446744073709551615)))'
    const client = await LiskClient.connect(base);
    const query: BcpAccountQuery = { address: Encoding.toAscii("15683599531721344316L") as Address };
    const account = await client.getAccount(query);
    expect(account.data[0].address).toEqual(Encoding.toAscii("15683599531721344316L"));
    expect(account.data[0].balance[0].tokenTicker).toEqual("LSK");
    expect(account.data[0].balance[0].sigFigs).toEqual(8);
    expect(account.data[0].balance[0].whole).toEqual(15);
    expect(account.data[0].balance[0].fractional).toEqual(48687542);
  });

  it("can get nonce", async () => {
    const client = await LiskClient.connect(base);
    const query: BcpAccountQuery = { address: Encoding.toAscii("15683599531721344316L") as Address };
    const nonce = await client.getNonce(query);

    expect(nonce.data[0].address).toEqual(Encoding.toAscii("15683599531721344316L"));
    // nonce is current timestamp +/- one second
    expect(nonce.data[0].nonce.toNumber()).toBeGreaterThanOrEqual(Date.now() / 1000 - 1);
    expect(nonce.data[0].nonce.toNumber()).toBeLessThanOrEqual(Date.now() / 1000 + 1);
  });

  it(
    "can post transaction",
    async () => {
      pendingWithoutLongRunning();

      const entry = new Ed25519KeyringEntry();
      const mainIdentity = await entry.createIdentity(
        await passphraseToKeypair(
          "oxygen fall sure lava energy veteran enroll frown question detail include maximum",
        ),
      );

      const recipientAddress = Encoding.toAscii("6076671634347365051L") as Address;

      const sendTx: SendTx = {
        kind: TransactionKind.Send,
        chainId: liskTestnet,
        signer: mainIdentity.pubkey,
        recipient: recipientAddress,
        memo: "We ❤️ developers – iov.one",
        amount: {
          whole: 1,
          fractional: 44550000,
          tokenTicker: "LSK" as TokenTicker,
        },
      };

      // Encode creation timestamp into nonce
      const nonce = generateNonce();
      const signingJob = liskCodec.bytesToSign(sendTx, nonce);
      const signature = await entry.createTransactionSignature(
        mainIdentity,
        signingJob.bytes,
        signingJob.prehashType,
        liskTestnet,
      );

      const signedTransaction = {
        transaction: sendTx,
        primarySignature: {
          nonce: nonce,
          publicKey: mainIdentity.pubkey,
          signature: signature,
        },
        otherSignatures: [],
      };
      const bytesToPost = liskCodec.bytesToPost(signedTransaction);

      const client = await LiskClient.connect(base);
      const result = await client.postTx(bytesToPost);
      expect(result).toBeTruthy();
      expect(result.metadata.height).toBeDefined();
      expect(result.metadata.height).toBeGreaterThan(6000000);
      expect(result.metadata.height).toBeLessThan(8000000);
    },
    40 * 1000,
  );
});
