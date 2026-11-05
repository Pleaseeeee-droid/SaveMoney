// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// TESTNET CONTRACT ONLY. NOT AUDITED. Do not deploy this with real money.
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Personal USDC lock for Base Sepolia only.
/// @dev No owner, pause, upgrade, emergency escape, or early unlock mechanism.
contract BaseSepoliaLockedSavings is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant CHAIN_ID = 84532; // Base Sepolia, NOT Base Mainnet.
    IERC20 public constant USDC = IERC20(0x036CbD53842c5426634e7929541eC2318f3dCF7e);

    address public immutable beneficiary;
    uint256 public immutable unlockTime;

    error WrongNetwork();
    error InvalidBeneficiary();
    error UnlockMustBeFuture();
    error VaultLocked();
    error VaultExpired();
    error NotBeneficiary();
    error ZeroAmount();
    error NothingToWithdraw();

    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    constructor(address beneficiary_, uint256 unlockTime_) {
        if (block.chainid != CHAIN_ID) revert WrongNetwork();
        if (beneficiary_ == address(0)) revert InvalidBeneficiary();
        if (unlockTime_ <= block.timestamp) revert UnlockMustBeFuture();
        beneficiary = beneficiary_;
        unlockTime = unlockTime_;
    }

    /// @notice Add more test USDC until the fixed unlock time.
    /// @dev Caller must approve this contract to spend the amount first.
    function deposit(uint256 amount) external nonReentrant {
        if (block.timestamp >= unlockTime) revert VaultExpired();
        if (amount == 0) revert ZeroAmount();
        USDC.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /// @notice Release the entire test USDC balance to the fixed beneficiary.
    function withdraw() external nonReentrant {
        if (msg.sender != beneficiary) revert NotBeneficiary();
        if (block.timestamp < unlockTime) revert VaultLocked();

        uint256 amount = USDC.balanceOf(address(this));
        if (amount == 0) revert NothingToWithdraw();

        USDC.safeTransfer(beneficiary, amount);
        emit Withdrawn(beneficiary, amount);
    }

    function balance() external view returns (uint256) {
        return USDC.balanceOf(address(this));
    }
}
