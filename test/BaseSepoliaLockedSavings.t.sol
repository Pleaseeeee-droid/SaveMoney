// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {BaseSepoliaLockedSavings} from "../contracts/BaseSepoliaLockedSavings.sol";

contract TestUSDC is ERC20 {
    constructor() ERC20("USDC", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract BaseSepoliaLockedSavingsTest is Test {
    uint256 constant BASE_SEPOLIA = 84532;
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);
    uint256 constant ONE_USDC = 1_000_000;

    BaseSepoliaLockedSavings internal vault;
    TestUSDC internal token;
    uint256 internal unlock;

    function setUp() public {
        vm.chainId(BASE_SEPOLIA);
        vm.warp(1_800_000_000);
        // Put a test token's runtime bytecode at Circle's Base Sepolia address.
        // These tests never interact with the live Base Sepolia network.
        TestUSDC implementation = new TestUSDC();
        vm.etch(USDC, address(implementation).code);
        token = TestUSDC(USDC);
        token.mint(ALICE, 100 * ONE_USDC);

        unlock = block.timestamp + 7 days;
        vault = new BaseSepoliaLockedSavings(ALICE, unlock);
        vm.prank(ALICE);
        token.approve(address(vault), type(uint256).max);
    }

    function testCorrectImmutableSettings() public view {
        assertEq(vault.beneficiary(), ALICE);
        assertEq(vault.unlockTime(), unlock);
        assertEq(vault.USDC(), USDC);
        assertEq(vault.CHAIN_ID(), BASE_SEPOLIA);
    }

    function testRejectDeploymentOnBaseMainnet() public {
        vm.chainId(8453);
        vm.expectRevert(BaseSepoliaLockedSavings.WrongNetwork.selector);
        new BaseSepoliaLockedSavings(ALICE, unlock);
    }

    function testRejectZeroBeneficiary() public {
        vm.expectRevert(BaseSepoliaLockedSavings.InvalidBeneficiary.selector);
        new BaseSepoliaLockedSavings(address(0), unlock);
    }

    function testRejectPastUnlockTime() public {
        vm.expectRevert(BaseSepoliaLockedSavings.UnlockMustBeFuture.selector);
        new BaseSepoliaLockedSavings(ALICE, block.timestamp);
    }

    function testCanDepositRepeatedlyBeforeUnlock() public {
        vm.startPrank(ALICE);
        vault.deposit(3 * ONE_USDC);
        vault.deposit(2 * ONE_USDC);
        vm.stopPrank();

        assertEq(vault.balance(), 5 * ONE_USDC);
        assertEq(token.balanceOf(ALICE), 95 * ONE_USDC);
    }

    function testEarlyWithdrawalRejectedEvenForBeneficiary() public {
        vm.prank(ALICE);
        vault.deposit(ONE_USDC);
        vm.prank(ALICE);
        vm.expectRevert(BaseSepoliaLockedSavings.VaultLocked.selector);
        vault.withdraw();

        assertEq(vault.balance(), ONE_USDC);
    }

    function testUnauthorizedWithdrawalRejectedAfterUnlock() public {
        vm.prank(ALICE);
        vault.deposit(ONE_USDC);
        vm.warp(unlock + 1);
        vm.prank(BOB);
        vm.expectRevert(BaseSepoliaLockedSavings.NotBeneficiary.selector);
        vault.withdraw();

        assertEq(vault.balance(), ONE_USDC);
    }

    function testWithdrawalSucceedsExactlyAtUnlockBoundary() public {
        vm.prank(ALICE);
        vault.deposit(5 * ONE_USDC);
        vm.warp(unlock);
        vm.prank(ALICE);
        vault.withdraw();

        assertEq(vault.balance(), 0);
        assertEq(token.balanceOf(ALICE), 100 * ONE_USDC);
    }

    function testDepositsRejectAtAndAfterUnlock() public {
        vm.warp(unlock);
        vm.prank(ALICE);
        vm.expectRevert(BaseSepoliaLockedSavings.VaultExpired.selector);
        vault.deposit(ONE_USDC);

        vm.warp(unlock + 10);
        vm.prank(ALICE);
        vm.expectRevert(BaseSepoliaLockedSavings.VaultExpired.selector);
        vault.deposit(ONE_USDC);
    }

    function testZeroDepositAndEmptyWithdrawalRejected() public {
        vm.prank(ALICE);
        vm.expectRevert(BaseSepoliaLockedSavings.ZeroAmount.selector);
        vault.deposit(0);

        vm.warp(unlock);
        vm.prank(ALICE);
        vm.expectRevert(BaseSepoliaLockedSavings.NothingToWithdraw.selector);
        vault.withdraw();
    }

    function testAnyoneCanContributeButNotWithdrawEarly() public {
        token.mint(BOB, ONE_USDC);
        vm.startPrank(BOB);
        token.approve(address(vault), ONE_USDC);
        vault.deposit(ONE_USDC);
        vm.expectRevert(BaseSepoliaLockedSavings.NotBeneficiary.selector);
        vault.withdraw();
        vm.stopPrank();
        vm.warp(unlock);
        vm.prank(ALICE);
        vault.withdraw();
        assertEq(token.balanceOf(ALICE), 101 * ONE_USDC);
    }
}
