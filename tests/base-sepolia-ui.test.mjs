import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('index.html');
const app=read('app.js');
const base=read('base-sepolia-vault.js');
const deploy=read('base-sepolia-deploy.js');
const legacy=read('blockchain-vault.js');
const api=read('api/vaults.js');
const sw=read('sw.js');

test('Base Sepolia module scripts are present and cached',()=>{
  for(const asset of ['base-sepolia-vault.js?v=2','base-sepolia-deploy.js?v=1']){
    assert.ok(html.includes(asset),asset+' missing from HTML');
    assert.ok(sw.includes(asset),asset+' missing from service-worker assets');
  }
});

test('all Base Sepolia UI IDs exist in HTML',()=>{
  for(const id of [
    'baseSepoliaSectionHead','baseSepoliaVaultPicker','baseSepoliaConnectBtn',
    'baseSepoliaRefreshBtn','baseSepoliaLockedBalance','baseSepoliaWalletBalance',
    'baseSepoliaUnlock','baseSepoliaAddress','baseSepoliaBeneficiary',
    'baseSepoliaDepositBtn','baseSepoliaWithdrawBtn','baseSepoliaAmount',
    'baseSepoliaExplorer','baseSepoliaStatus','baseSepoliaLockBadge',
    'baseSepoliaTestLockBtn','baseSepoliaLockResult'
  ])assert.ok(html.includes('id="'+id+'"'),id+' is missing');
});

test('Base Sepolia testnet identifiers and canonical USDC are pinned',()=>{
  assert.ok(base.includes("const CHAIN_HEX='0x14a34'"));
  assert.ok(deploy.includes("const CHAIN_ID=84532"));
  assert.ok(base.toLowerCase().includes('0x036cbd53842c5426634e7929541ec2318f3dcf7e'));
  assert.ok(deploy.toLowerCase().includes('0x036cbd53842c5426634e7929541ec2318f3dcf7e'));
  assert.ok(deploy.includes("SOURCE_PATH='contracts/BaseSepoliaLockedSavings.sol'"));
});

test('Base Sepolia deployer does not use Base Mainnet or mainnet token',()=>{
  for(const source of [base,deploy]){
    assert.equal(source.includes('https://mainnet.base.org'),false);
    assert.equal(source.toLowerCase().includes('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'),false);
  }
  assert.ok(deploy.includes("wallet_switchEthereumChain"));
});

test('SaveMoney manages legacy and Base Sepolia vaults separately',()=>{
  assert.ok(app.includes("window.SaveMoneyBaseApp?.select?."));
  assert.ok(app.includes("window.SaveMoneyBaseDeployment"));
  assert.ok(app.includes("deployer.activate(created)"));
  assert.ok(legacy.includes('Number(v.chain.chainId)!==11155111'));
  assert.ok(api.includes('84532:'));
  assert.ok(api.includes('11155111:'));
});

test('withdrawal check is read-only and requires the exact VaultLocked revert',()=>{
  assert.ok(base.includes('async function testEarlyWithdrawalLock()'));
  assert.ok(base.includes('LOCK_CHECK_ABI.encodeFunctionData(\'withdraw\')'));
  assert.ok(base.includes('await readProvider.call('));
  assert.ok(base.includes("LOCKED_REVERT_SELECTOR"));
  assert.ok(base.includes("revert?.revert?.name==='VaultLocked'"));
  assert.ok(base.includes("if(!revert){"));
  assert.ok(base.includes('INCONCLUSIVE:'));
  assert.ok(base.includes("No transaction was sent"));
  assert.ok(base.includes("baseSepoliaTestLockBtn"));
});

test('all client modules and mapped server endpoint parse as JavaScript',()=>{
  for(const filename of [
    'app.js','blockchain-vault.js','base-sepolia-vault.js','base-sepolia-deploy.js'
  ])assert.doesNotThrow(()=>new Function(read(filename)),filename);
  assert.doesNotThrow(()=>new Function(api.replace(/^export default /m,'')));
});
