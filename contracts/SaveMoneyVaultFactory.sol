// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract SaveMoneyVault {
    IERC20 public immutable token;
    address public immutable beneficiary;
    uint256 public immutable unlockTime;

    error VaultLocked();
    error VaultExpired();
    error NotBeneficiary();
    error TransferFailed();
    error NothingToWithdraw();

    constructor(address tokenAddress, address beneficiaryAddress, uint256 unlockTimestamp) {
        require(tokenAddress != address(0), "Invalid token");
        require(beneficiaryAddress != address(0), "Invalid beneficiary");
        require(unlockTimestamp > block.timestamp, "Unlock must be future");

        token = IERC20(tokenAddress);
        beneficiary = beneficiaryAddress;
        unlockTime = unlockTimestamp;
    }

    function deposit(uint256 amount) external {
        if (block.timestamp >= unlockTime) revert VaultExpired();
        require(amount > 0, "Amount must be greater than zero");

        bool success = token.transferFrom(msg.sender, address(this), amount);
        if (!success) revert TransferFailed();
    }

    function balance() public view returns (uint256) {
        return token.balanceOf(address(this));
    }

    function withdraw() external {
        if (msg.sender != beneficiary) revert NotBeneficiary();
        if (block.timestamp < unlockTime) revert VaultLocked();

        uint256 amount = balance();
        if (amount == 0) revert NothingToWithdraw();

        bool success = token.transfer(beneficiary, amount);
        if (!success) revert TransferFailed();
    }
}

contract SaveMoneyVaultFactory {
    address public immutable token;

    event VaultCreated(
        address indexed vault,
        address indexed beneficiary,
        uint256 unlockTime
    );

    constructor(address tokenAddress) {
        require(tokenAddress != address(0), "Invalid token");
        token = tokenAddress;
    }

    function createVault(uint256 unlockTimestamp) external returns (address vaultAddress) {
        SaveMoneyVault vault = new SaveMoneyVault(token, msg.sender, unlockTimestamp);
        vaultAddress = address(vault);
        emit VaultCreated(vaultAddress, msg.sender, unlockTimestamp);
    }
}
