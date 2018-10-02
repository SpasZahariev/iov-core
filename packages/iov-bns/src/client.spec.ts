import Long from "long";

import {
  Address,
  BcpAccount,
  BcpNonce,
  BcpSwapQuery,
  BcpTransactionResponse,
  Nonce,
  SendTx,
  SwapClaimTx,
  SwapIdBytes,
  SwapOfferTx,
  SwapState,
  TokenTicker,
  TransactionKind,
} from "@iov/bcp-types";
import { Sha256 } from "@iov/crypto";
import { Encoding } from "@iov/encoding";
import {
  Ed25519SimpleAddressKeyringEntry,
  LocalIdentity,
  PublicIdentity,
  UserProfile,
} from "@iov/keycontrol";
import { asArray, lastValue } from "@iov/stream";
import { TxQuery } from "@iov/tendermint-types";

import { bnsCodec } from "./bnscodec";
import { Client } from "./client";
import { bnsFromOrToTag, bnsSwapQueryTags } from "./tags";
import { keyToAddress } from "./util";

const skipTests = (): boolean => !process.env.BOV_ENABLED;

const pendingWithoutBov = () => {
  if (skipTests()) {
    pending("Set BOV_ENABLED to enable bov-based tests");
  }
};

const sleep = (t: number) => new Promise(resolve => setTimeout(resolve, t));

describe("Integration tests with bov+tendermint", () => {
  // the first key generated from this mneumonic produces the given address
  // this account has money in the genesis file (setup in docker)
  const mnemonic = "degree tackle suggest window test behind mesh extra cover prepare oak script";
  const expectedFaucetAddress = Encoding.fromHex("b1ca7e78f74423ae01da3b51e676934d9105f282") as Address;
  const cash = "CASH" as TokenTicker;

  // TODO: had issues with websockets? check again later, maybe they need to close at end?
  // max open connections??? (but 900 by default)
  const tendermintUrl = "ws://localhost:22345";

  async function userProfileWithFaucet(): Promise<UserProfile> {
    const profile = new UserProfile();
    profile.addEntry(Ed25519SimpleAddressKeyringEntry.fromMnemonic(mnemonic));
    await profile.createIdentity(0, 0);
    return profile;
  }

  const faucetId = (profile: UserProfile): LocalIdentity => {
    const ids = profile.getIdentities(0);
    expect(ids.length).toBeGreaterThanOrEqual(1);
    return ids[0];
  };

  const getNonce = async (client: Client, addr: Address): Promise<Nonce> => {
    const data = (await client.getNonce({ address: addr })).data;
    return data.length === 0 ? (Long.fromInt(0) as Nonce) : data[0].nonce;
  };

  // recipient will make accounts if needed, returns path n
  // n must be >= 1
  async function recipient(profile: UserProfile, n: number): Promise<LocalIdentity> {
    if (n < 1) {
      throw new Error("Recipient count starts at 1");
    }
    return profile.createIdentity(0, n);
  }

  it("Generate proper faucet address", async () => {
    const profile = await userProfileWithFaucet();
    const id = faucetId(profile);
    const addr = keyToAddress(id.pubkey);
    expect(addr).toEqual(expectedFaucetAddress);
  });

  it("Can connect to tendermint", async () => {
    pendingWithoutBov();
    const client = await Client.connect(tendermintUrl);

    // we should get a reasonable string here
    const chainId = await client.chainId();
    expect(chainId).toBeTruthy();
    expect(chainId.length).toBeGreaterThan(6);
    expect(chainId.length).toBeLessThan(26);

    // we expect some block to have been created
    const height = await client.height();
    expect(height).toBeGreaterThan(1);

    client.disconnect();
  });

  it("can disconnect from tendermint", async () => {
    pendingWithoutBov();
    const client = await Client.connect(tendermintUrl);
    const chainId = await client.chainId();
    expect(chainId).toBeTruthy();
    client.disconnect();
  });

  it("Can query all tickers", async () => {
    pendingWithoutBov();
    const client = await Client.connect(tendermintUrl);

    const tickers = await client.getAllTickers();
    expect(tickers.data.length).toEqual(1);
    const ticker = tickers.data[0];
    expect(ticker.tokenTicker).toEqual(cash);
    expect(ticker.tokenName).toEqual("Main token of this chain");
    expect(ticker.sigFigs).toEqual(6);

    client.disconnect();
  });

  it("Can query accounts", async () => {
    pendingWithoutBov();
    const client = await Client.connect(tendermintUrl);

    const profile = await userProfileWithFaucet();
    const faucet = faucetId(profile);
    const faucetAddr = keyToAddress(faucet.pubkey);

    const rcpt = await recipient(profile, 1);
    const rcptAddr = keyToAddress(rcpt.pubkey);

    // can get the faucet by address (there is money)
    const source = await client.getAccount({ address: faucetAddr });
    expect(source.data.length).toEqual(1);
    const addrAcct = source.data[0];
    expect(addrAcct.address).toEqual(faucetAddr);
    expect(addrAcct.name).toEqual("admin");
    expect(addrAcct.balance.length).toEqual(1);
    expect(addrAcct.balance[0].tokenTicker).toEqual(cash);
    expect(addrAcct.balance[0].whole).toBeGreaterThan(1000000);

    // can get the faucet by name, same result
    const namedSource = await client.getAccount({ name: "admin" });
    expect(namedSource.data.length).toEqual(1);
    const nameAcct = namedSource.data[0];
    expect(nameAcct).toEqual(addrAcct);

    // empty account has no results
    const empty = await client.getAccount({ address: rcptAddr });
    expect(empty).toBeTruthy();
    expect(empty.data.length).toEqual(0);

    client.disconnect();
  });

  it("Can query empty nonce", async () => {
    pendingWithoutBov();
    const client = await Client.connect(tendermintUrl);

    const profile = await userProfileWithFaucet();
    const rcpt = await recipient(profile, 1);
    const rcptAddr = keyToAddress(rcpt.pubkey);

    // can get the faucet by address (there is money)
    const nonce = await getNonce(client, rcptAddr);
    expect(nonce.toInt()).toEqual(0);

    client.disconnect();
  });

  it("Can send transaction", async () => {
    pendingWithoutBov();
    const client = await Client.connect(tendermintUrl);
    const chainId = await client.chainId();
    // store minHeight before sending the tx, so we can filter out
    // if we re-run the test, still only find one tx in search
    // const minHeight = (await client.height()) - 1;

    const profile = await userProfileWithFaucet();

    const faucet = faucetId(profile);
    const faucetAddr = keyToAddress(faucet.pubkey);
    const rcpt = await recipient(profile, 2);
    const rcptAddr = keyToAddress(rcpt.pubkey);

    // check current nonce (should be 0, but don't fail if used by other)
    const nonce = await getNonce(client, faucetAddr);

    // construct a sendtx, this is normally used in the IovWriter api
    const sendTx: SendTx = {
      kind: TransactionKind.Send,
      chainId,
      signer: faucet.pubkey,
      recipient: rcptAddr,
      memo: "My first payment",
      amount: {
        whole: 500,
        fractional: 75000,
        tokenTicker: cash,
      },
    };
    const signed = await profile.signTransaction(0, faucet, sendTx, bnsCodec, nonce);
    const txBytes = bnsCodec.bytesToPost(signed);
    const post = await client.postTx(txBytes);
    // FIXME: we really should add more info here, but this is in the spec
    expect(post.metadata.status).toBe(true);

    // we should be a little bit richer
    const gotMoney = await client.getAccount({ address: rcptAddr });
    expect(gotMoney).toBeTruthy();
    expect(gotMoney.data.length).toEqual(1);
    const paid = gotMoney.data[0];
    expect(paid.balance.length).toEqual(1);
    // we may post multiple times if we have multiple tests,
    // so just ensure at least one got in
    expect(paid.balance[0].whole).toBeGreaterThanOrEqual(500);
    expect(paid.balance[0].fractional).toBeGreaterThanOrEqual(75000);

    // and the nonce should go up, to be at least one
    // (worrying about replay issues)
    const fNonce = await getNonce(client, faucetAddr);
    expect(fNonce.toInt()).toBeGreaterThanOrEqual(1);

    // now verify we can query the same tx back
    const txQuery = { tags: [bnsFromOrToTag(faucetAddr)] };
    const search = await client.searchTx(txQuery);
    expect(search.length).toBeGreaterThanOrEqual(1);
    // make sure we get a valid signature
    const mine = search[search.length - 1];
    expect(mine.primarySignature.nonce).toEqual(nonce);
    expect(mine.primarySignature.signature.length).toBeTruthy();
    expect(mine.otherSignatures.length).toEqual(0);
    const tx = mine.transaction;
    expect(tx.kind).toEqual(sendTx.kind);
    expect(tx).toEqual(sendTx);
    // make sure we have a txid
    expect(mine.txid).toBeDefined();
    expect(mine.txid.length).toBeGreaterThan(0);

    client.disconnect();
  });

  it("can get live block feed", async () => {
    pendingWithoutBov();
    const client = await Client.connect(tendermintUrl);

    // get the next three block heights
    const heights = asArray(client.changeBlock().take(3));
    await heights.finished();

    const nums = heights.value();
    // we should get three consequtive numbers
    expect(nums.length).toEqual(3);
    expect(nums[1]).toEqual(nums[0] + 1);
    expect(nums[2]).toEqual(nums[1] + 1);
  });

  const sendCash = async (
    client: Client,
    profile: UserProfile,
    faucet: PublicIdentity,
    rcptAddr: Address,
  ): Promise<BcpTransactionResponse> => {
    // construct a sendtx, this is normally used in the IovWriter api
    const chainId = await client.chainId();
    const faucetAddr = keyToAddress(faucet.pubkey);
    const nonce = await getNonce(client, faucetAddr);
    const sendTx: SendTx = {
      kind: TransactionKind.Send,
      chainId,
      signer: faucet.pubkey,
      recipient: rcptAddr,
      amount: {
        whole: 680,
        fractional: 0,
        tokenTicker: cash,
      },
    };
    const signed = await profile.signTransaction(0, faucet, sendTx, bnsCodec, nonce);
    const txBytes = bnsCodec.bytesToPost(signed);
    return client.postTx(txBytes);
  };

  it("can get live tx feed", async () => {
    pendingWithoutBov();
    const client = await Client.connect(tendermintUrl);
    const profile = await userProfileWithFaucet();

    const faucet = faucetId(profile);
    const rcpt = await recipient(profile, 62);
    const rcptAddr = keyToAddress(rcpt.pubkey);

    // make sure that we have no tx here
    const query: TxQuery = { tags: [bnsFromOrToTag(rcptAddr)] };
    const origSearch = await client.searchTx(query);
    expect(origSearch.length).toEqual(0);

    const post = await sendCash(client, profile, faucet, rcptAddr);
    expect(post.metadata.status).toBe(true);
    const firstId = post.data.txid;
    expect(firstId).toBeDefined();

    // hmmm... there seems to be a lag here when Travis CI is heavily loaded...
    await sleep(50);
    const middleSearch = await client.searchTx(query);
    expect(middleSearch.length).toEqual(1);

    // live.value() maintains all transactions
    const live = asArray(client.liveTx(query));

    const secondPost = await sendCash(client, profile, faucet, rcptAddr);
    expect(secondPost.metadata.status).toBe(true);
    const secondId = secondPost.data.txid;
    expect(secondId).toBeDefined();

    // now, let's make sure it is picked up in the search
    // hmmm... there seems to be a lag here when Travis CI is heavily loaded...
    await sleep(50);
    const afterSearch = await client.searchTx(query);
    expect(afterSearch.length).toEqual(2);
    // make sure we have unique, defined txids
    const txIds = afterSearch.map(tx => tx.txid);
    expect(txIds.length).toEqual(2);
    expect(txIds[0]).toEqual(firstId);
    expect(txIds[1]).toEqual(secondId);
    expect(txIds[0]).not.toEqual(txIds[1]);

    // give time for all events to be processed
    await sleep(100);
    // this should grab the tx before it started, as well as the one after
    expect(live.value().length).toEqual(2);
    // make sure the txids also match
    expect(live.value()[0].txid).toEqual(afterSearch[0].txid);
    expect(live.value()[1].txid).toEqual(afterSearch[1].txid);

    client.disconnect();
  });

  it("can provide change feeds", async () => {
    pendingWithoutBov();
    const client = await Client.connect(tendermintUrl);
    const profile = await userProfileWithFaucet();

    const faucet = faucetId(profile);
    const faucetAddr = keyToAddress(faucet.pubkey);
    const rcpt = await recipient(profile, 87);
    const rcptAddr = keyToAddress(rcpt.pubkey);

    // let's watch for all changes, capture them in arrays
    const balanceFaucet = asArray(client.changeBalance(faucetAddr));
    const balanceRcpt = asArray(client.changeBalance(rcptAddr));
    const nonceFaucet = asArray(client.changeNonce(faucetAddr));
    const nonceRcpt = asArray(client.changeNonce(rcptAddr));

    const post = await sendCash(client, profile, faucet, rcptAddr);
    expect(post.metadata.status).toBe(true);
    const first = post.metadata.height;
    expect(first).toBeDefined();

    const secondPost = await sendCash(client, profile, faucet, rcptAddr);
    expect(secondPost.metadata.status).toBe(true);
    const second = secondPost.metadata.height;
    expect(second).toBeDefined();

    // give time for all events to be processed
    await sleep(50);

    // both should show up on the balance changes
    expect(balanceFaucet.value().length).toEqual(2);
    expect(balanceRcpt.value().length).toEqual(2);

    // only faucet should show up on the nonce changes
    expect(nonceFaucet.value().length).toEqual(2);
    expect(nonceRcpt.value().length).toEqual(0);

    // make sure proper values
    expect(balanceFaucet.value()).toEqual([first!, second!]);

    client.disconnect();
  });

  // make sure we can get a reactive account balance (as well as nonce)
  it("can watch accounts", async () => {
    pendingWithoutBov();
    const client = await Client.connect(tendermintUrl);
    const profile = await userProfileWithFaucet();

    const faucet = faucetId(profile);
    const faucetAddr = keyToAddress(faucet.pubkey);
    const rcpt = await recipient(profile, 57);
    const rcptAddr = keyToAddress(rcpt.pubkey);

    // let's watch for all changes, capture them in a value sink
    const faucetAcct = lastValue<BcpAccount | undefined>(client.watchAccount({ address: faucetAddr }));
    const rcptAcct = lastValue<BcpAccount | undefined>(client.watchAccount({ address: rcptAddr }));

    const faucetNonce = lastValue<BcpNonce | undefined>(client.watchNonce({ address: faucetAddr }));
    const rcptNonce = lastValue<BcpNonce | undefined>(client.watchNonce({ address: rcptAddr }));

    // give it a chance to get initial feed before checking and proceeding
    await sleep(100);

    // make sure there are original values sent on the wire
    expect(rcptAcct.value()).toBeUndefined();
    expect(faucetAcct.value()).toBeDefined();
    expect(faucetAcct.value()!.name).toEqual("admin");
    expect(faucetAcct.value()!.balance.length).toEqual(1);
    const start = faucetAcct.value()!.balance[0];

    // make sure original nonces make sense
    expect(rcptNonce.value()).toBeUndefined();
    expect(faucetNonce.value()).toBeDefined();
    // store original nonce, this should increase after tx
    const origNonce = faucetNonce.value()!.nonce;
    expect(origNonce.toNumber()).toBeGreaterThan(0);

    // send some cash and see if they update...
    const post = await sendCash(client, profile, faucet, rcptAddr);
    expect(post.metadata.status).toBe(true);

    // give it a chance to get updates before checking and proceeding
    await sleep(100);

    // rcptAcct should now have a value
    expect(rcptAcct.value()).toBeDefined();
    expect(rcptAcct.value()!.name).toBeUndefined();
    expect(rcptAcct.value()!.balance.length).toEqual(1);
    expect(rcptAcct.value()!.balance[0].whole).toEqual(680);
    // but rcptNonce still undefined
    expect(rcptNonce.value()).toBeUndefined();

    // facuetAcct should have gone down a bit
    expect(faucetAcct.value()).toBeDefined();
    expect(faucetAcct.value()!.name).toEqual("admin");
    expect(faucetAcct.value()!.balance.length).toEqual(1);
    const end = faucetAcct.value()!.balance[0];
    expect(end).not.toEqual(start);
    expect(end.whole + 680).toEqual(start.whole);
    // and faucetNonce gone up by one
    expect(faucetNonce.value()).toBeDefined();
    const finalNonce: Long = faucetNonce.value()!.nonce;
    expect(finalNonce).toEqual(origNonce.add(1));

    // clean up with disconnect at the end...
    client.disconnect();
  });

  it("Can start atomic swap", async () => {
    pendingWithoutBov();
    const client = await Client.connect(tendermintUrl);
    const chainId = await client.chainId();

    const profile = await userProfileWithFaucet();

    const faucet = faucetId(profile);
    const faucetAddr = keyToAddress(faucet.pubkey);
    const rcpt = await recipient(profile, 7);
    const rcptAddr = keyToAddress(rcpt.pubkey);

    // check current nonce (should be 0, but don't fail if used by other)
    const nonce = await getNonce(client, faucetAddr);

    const preimage = Encoding.toAscii("my top secret phrase... keep it on the down low ;)");
    const hash = new Sha256(preimage).digest();

    const initSwaps = await client.getSwap({ recipient: rcptAddr });
    expect(initSwaps.data.length).toEqual(0);

    // construct a sendtx, this is normally used in the IovWriter api
    const swapOfferTx: SwapOfferTx = {
      kind: TransactionKind.SwapOffer,
      chainId,
      signer: faucet.pubkey,
      recipient: rcptAddr,
      amount: [
        {
          whole: 123,
          fractional: 456000,
          tokenTicker: cash,
        },
      ],
      timeout: 1000,
      preimage,
    };

    const signed = await profile.signTransaction(0, faucet, swapOfferTx, bnsCodec, nonce);
    const txBytes = bnsCodec.bytesToPost(signed);
    const post = await client.postTx(txBytes);
    // FIXME: we really should add more info here, but this is in the spec
    expect(post.metadata.status).toBe(true);
    const txHeight = post.metadata.height;
    expect(txHeight).toBeTruthy();
    expect(txHeight).toBeGreaterThan(1);
    const txResult = post.data.result;
    expect(txResult.length).toBe(8);
    expect(txResult).toEqual(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]));
    const txid = post.data.txid;
    expect(txid.length).toBe(20);

    // now query by the txid
    const search = await client.searchTx({ hash: txid, tags: [] });
    expect(search.length).toEqual(1);
    // make sure we get he same tx loaded
    const loaded = search[0];
    expect(loaded.txid).toEqual(txid);
    // we never write the offer (with preimage) to a chain, only convert it to a SwapCounterTx
    // which only has the hashed data, then commit it (thus the different kind is expected)
    expect(loaded.transaction.kind).toEqual(TransactionKind.SwapCounter);
    expect((loaded.transaction as SwapOfferTx).recipient).toEqual(swapOfferTx.recipient);
    // make sure it also stored a result
    expect(loaded.result).toEqual(txResult);
    expect(loaded.height).toEqual(txHeight!);

    // ----  prepare queries
    const querySwapId: BcpSwapQuery = { swapid: txResult as SwapIdBytes };
    const querySwapSender: BcpSwapQuery = { sender: faucetAddr };
    const querySwapRecipient: BcpSwapQuery = { recipient: rcptAddr };
    const querySwapHash: BcpSwapQuery = { hashlock: hash };

    // ----- client.searchTx() -----
    // we should be able to find the transaction through quite a number of tag queries

    const txById = await client.searchTx({ tags: [bnsSwapQueryTags(querySwapId)] });
    expect(txById.length).toEqual(1);
    expect(txById[0].txid).toEqual(txid);

    const txBySender = await client.searchTx({ tags: [bnsSwapQueryTags(querySwapSender)] });
    expect(txBySender.length).toEqual(1);
    expect(txBySender[0].txid).toEqual(txid);

    const txByRecipient = await client.searchTx({ tags: [bnsSwapQueryTags(querySwapRecipient)] });
    expect(txByRecipient.length).toEqual(1);
    expect(txByRecipient[0].txid).toEqual(txid);

    const txByHash = await client.searchTx({ tags: [bnsSwapQueryTags(querySwapHash)] });
    expect(txByHash.length).toEqual(1);
    expect(txByHash[0].txid).toEqual(txid);

    // ----- client.getSwap() -------

    // we can also swap by id (returned by the transaction result)
    const idSwap = await client.getSwap(querySwapId);
    expect(idSwap.data.length).toEqual(1);

    const swap = idSwap.data[0];
    expect(swap.kind).toEqual(SwapState.Open);

    // and it matches expectations
    const swapData = swap.data;
    expect(swapData.id).toEqual(txResult);
    expect(swapData.sender).toEqual(faucetAddr);
    expect(swapData.recipient).toEqual(rcptAddr);
    expect(swapData.timeout).toEqual(1000); // FIXME: timeout from tx (the next line is expected, right?)
    // expect(swapData.timeout).toEqual(loaded.height + 1000); // when tx was commited plus timeout
    expect(swapData.amount.length).toEqual(1);
    expect(swapData.amount[0].whole).toEqual(123);
    expect(swapData.amount[0].tokenTicker).toEqual(cash);
    expect(swapData.hashlock).toEqual(hash);

    // we can get the swap by the recipient
    const rcptSwap = await client.getSwap(querySwapRecipient);
    expect(rcptSwap.data.length).toEqual(1);
    expect(rcptSwap.data[0]).toEqual(swap);

    // we can also get it by the sender
    const sendSwap = await client.getSwap(querySwapSender);
    expect(sendSwap.data.length).toEqual(1);
    expect(sendSwap.data[0]).toEqual(swap);

    // we can also get it by the hash
    const hashSwap = await client.getSwap(querySwapHash);
    expect(hashSwap.data.length).toEqual(1);
    expect(hashSwap.data[0]).toEqual(swap);
  });

  const openSwap = async (
    client: Client,
    profile: UserProfile,
    sender: PublicIdentity,
    rcptAddr: Address,
    preimage: Uint8Array,
  ): Promise<BcpTransactionResponse> => {
    // construct a swapOfferTx, sign and post to the chain
    const chainId = await client.chainId();
    const nonce = await getNonce(client, keyToAddress(sender.pubkey));
    const swapOfferTx: SwapOfferTx = {
      kind: TransactionKind.SwapOffer,
      chainId,
      signer: sender.pubkey,
      recipient: rcptAddr,
      amount: [
        {
          whole: 21,
          fractional: 0,
          tokenTicker: cash,
        },
      ],
      timeout: 5000,
      preimage,
    };
    const signed = await profile.signTransaction(0, sender, swapOfferTx, bnsCodec, nonce);
    const txBytes = bnsCodec.bytesToPost(signed);
    return client.postTx(txBytes);
  };

  const claimSwap = async (
    client: Client,
    profile: UserProfile,
    sender: PublicIdentity,
    swapId: SwapIdBytes,
    preimage: Uint8Array,
  ): Promise<BcpTransactionResponse> => {
    // construct a swapOfferTx, sign and post to the chain
    const chainId = await client.chainId();
    const nonce = await getNonce(client, keyToAddress(sender.pubkey));
    const swapClaimTx: SwapClaimTx = {
      kind: TransactionKind.SwapClaim,
      chainId,
      signer: sender.pubkey,
      swapId,
      preimage,
    };
    const signed = await profile.signTransaction(0, sender, swapClaimTx, bnsCodec, nonce);
    const txBytes = bnsCodec.bytesToPost(signed);
    return client.postTx(txBytes);
  };

  it("Get and watch atomic swap lifecycle", async () => {
    pendingWithoutBov();
    const client = await Client.connect(tendermintUrl);
    const profile = await userProfileWithFaucet();

    const faucet = faucetId(profile);
    const rcpt = await recipient(profile, 121);
    const rcptAddr = keyToAddress(rcpt.pubkey);

    // create the preimages for the three swaps
    const preimage1 = Encoding.toAscii("the first swap is easy");
    // const hash1 = new Sha256(preimage1).digest();
    const preimage2 = Encoding.toAscii("ze 2nd iS l337 !@!");
    // const hash2 = new Sha256(preimage2).digest();
    const preimage3 = Encoding.toAscii("and this one is a gift.");
    // const hash3 = new Sha256(preimage3).digest();

    // nothing to start with
    const rcptQuery = { recipient: rcptAddr };
    const initSwaps = await client.getSwap(rcptQuery);
    expect(initSwaps.data.length).toEqual(0);

    // make two offers
    const res1 = await openSwap(client, profile, faucet, rcptAddr, preimage1);
    const id1 = res1.data.result as SwapIdBytes;
    expect(id1.length).toEqual(8);

    const res2 = await openSwap(client, profile, faucet, rcptAddr, preimage2);
    const id2 = res2.data.result as SwapIdBytes;
    expect(id2.length).toEqual(8);

    // find two open
    const midSwaps = await client.getSwap(rcptQuery);
    expect(midSwaps.data.length).toEqual(2);
    const [open1, open2] = midSwaps.data;
    expect(open1.kind).toEqual(SwapState.Open);
    expect(open1.data.id).toEqual(id1);
    expect(open2.kind).toEqual(SwapState.Open);
    expect(open2.data.id).toEqual(id2);

    // then claim, offer, claim - 2 closed, 1 open
    await claimSwap(client, profile, faucet, id2, preimage1);

    // start to watch
    const liveView = asArray(client.watchSwap(rcptQuery));

    const res3 = await openSwap(client, profile, faucet, rcptAddr, preimage3);
    const id3 = res3.data.result as SwapIdBytes;
    expect(id3.length).toEqual(8);

    await claimSwap(client, profile, faucet, id1, preimage1);

    // make sure we find two claims, one open
    const finalSwaps = await client.getSwap({ recipient: rcptAddr });
    expect(finalSwaps.data.length).toEqual(3);
    const [open3, claim2, claim1] = finalSwaps.data;
    expect(open3.kind).toEqual(SwapState.Open);
    expect(open3.data.id).toEqual(id3);
    expect(claim2.kind).toEqual(SwapState.Claimed);
    expect(claim2.data.id).toEqual(id2);
    expect(claim1.kind).toEqual(SwapState.Claimed);
    expect(claim1.data.id).toEqual(id1);

    // validate liveView is correct
    const vals = liveView.value();
    expect(vals.length).toEqual(5);
    expect(vals[0].kind).toEqual(SwapState.Open);
    expect(vals[0].data.id).toEqual(id1);
    expect(vals[1].kind).toEqual(SwapState.Open);
    expect(vals[1].data.id).toEqual(id2);
    expect(vals[2].kind).toEqual(SwapState.Claimed);
    expect(vals[2].data.id).toEqual(id2);
    expect(vals[3].kind).toEqual(SwapState.Open);
    expect(vals[3].data.id).toEqual(id3);
    expect(vals[4].kind).toEqual(SwapState.Claimed);
    expect(vals[4].data.id).toEqual(id1);
  });
});
