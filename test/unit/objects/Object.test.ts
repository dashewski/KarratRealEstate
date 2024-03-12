import { deployments, ethers } from 'hardhat'
import { expect, assert } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  MultisigWallet,
  MultisigWallet__factory,
  ObjectsFactory__factory,
  ObjectsFactory,
  IERC20__factory,
  Object__factory,
  Treasury,
  Treasury__factory,
  Object as ObjectContract,
} from '../../../typechain-types'
import * as helpers from '@nomicfoundation/hardhat-network-helpers'
import { USDT } from '../../../constants/addresses'
import ERC20Minter from '../../utils/ERC20Minter'
import { getImplementationAddress } from '@openzeppelin/upgrades-core'
import { BigNumber } from 'ethers'

describe(`Object`, () => {
  let ownersMultisig: MultisigWallet
  let ownersMultisigImpersonated: SignerWithAddress
  let administrator: SignerWithAddress
  let user: SignerWithAddress
  let objectsFactory: ObjectsFactory
  let treasury: Treasury
  let initSnapshot: string

  before(async () => {
    await deployments.fixture()

    objectsFactory = ObjectsFactory__factory.connect(
      (await deployments.get('ObjectsFactory')).address,
      ethers.provider,
    )

    treasury = Treasury__factory.connect(
      (await deployments.get('Treasury')).address,
      ethers.provider,
    )

    const OwnersMultisigDeployment = await deployments.get('OwnersMultisig')
    ownersMultisig = MultisigWallet__factory.connect(
      OwnersMultisigDeployment.address,
      ethers.provider,
    )
    await helpers.impersonateAccount(ownersMultisig.address)
    ownersMultisigImpersonated = await ethers.getSigner(ownersMultisig.address)
    await helpers.setBalance(ownersMultisigImpersonated.address, ethers.utils.parseEther('100'))

    const accounts = await ethers.getSigners()
    user = accounts[1]

    const administratorAddress = '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955'
    await helpers.impersonateAccount(administratorAddress)
    administrator = await ethers.getSigner(administratorAddress)
    await helpers.setBalance(ownersMultisigImpersonated.address, ethers.utils.parseEther('100'))

    initSnapshot = await ethers.provider.send('evm_snapshot', [])
  })

  afterEach(async () => {
    await ethers.provider.send('evm_revert', [initSnapshot])
    initSnapshot = await ethers.provider.send('evm_snapshot', [])
  })

  describe('FullSale Object', () => {
    let object: ObjectContract
    let objectId: number
    let stageId: number
    let maxShares: number
    let saleStopTimestamp: number
    let priceOneShare: BigNumber
    let referralProgramEnabled: boolean

    beforeEach(async () => {
      objectId = 1
      stageId = 1
      maxShares = 100
      saleStopTimestamp = 0
      priceOneShare = ethers.utils.parseUnits('100', 18)
      referralProgramEnabled = true
      await objectsFactory
        .connect(ownersMultisigImpersonated)
        .createFullSaleObject(maxShares, saleStopTimestamp, priceOneShare, referralProgramEnabled)

      const objectAddress = await objectsFactory.objectAddress(objectId)
      object = Object__factory.connect(objectAddress, ethers.provider)
    })

    it('Regular: estimateBuySharesUSD', async () => {
      const buyShares = 10

      const estimateBuySharesUSD = await object.estimateBuySharesUSD(user.address, buyShares)
      const calculatedSharesUSD = priceOneShare.mul(buyShares)

      assert(
        estimateBuySharesUSD.eq(calculatedSharesUSD),
        'estimateBuySharesUSD != calculatedSharesUSD',
      )
    })

    it('Regular: buy', async () => {
      const buyShares = 10

      const payToken = IERC20__factory.connect(USDT, ethers.provider)
      await ERC20Minter.mint(payToken.address, user.address, 10000)

      const estimateBuySharesToken = await object.estimateBuySharesToken(
        user.address,
        buyShares,
        payToken.address,
      )

      const objectPayTokenBalanceBefore = await payToken.balanceOf(object.address)
      const userPayTokenBalanceBefore = await payToken.balanceOf(user.address)
      const nftBalanceBefore = await object.balanceOf(user.address)

      await payToken.connect(user).approve(object.address, ethers.constants.MaxUint256)

      const tokenId = 1
      await object
        .connect(user)
        .buyShares(
          buyShares,
          payToken.address,
          ethers.constants.MaxUint256,
          ethers.constants.AddressZero,
        )

      const objectPayTokenBalanceAfter = await payToken.balanceOf(object.address)
      const userPayTokenBalanceAfter = await payToken.balanceOf(user.address)
      const nftBalanceAfter = await object.balanceOf(user.address)

      assert(
        objectPayTokenBalanceAfter.eq(objectPayTokenBalanceBefore.add(estimateBuySharesToken)),
        `objectPayTokenBalanceAfter!`,
      )

      assert(
        userPayTokenBalanceAfter.eq(userPayTokenBalanceBefore.sub(estimateBuySharesToken)),
        `payTokenAmount balane: userPayTokenBalanceAfter != userPayTokenBalanceBefore - estimateBuySharesToken
         | ${userPayTokenBalanceAfter} != ${userPayTokenBalanceBefore} - ${estimateBuySharesToken})`,
      )

      assert(
        nftBalanceAfter.eq(nftBalanceBefore.add(1)),
        `payTokenAmount balane: nftBalanceAfter != nftBalanceBefore + 1
         | ${nftBalanceAfter} != ${nftBalanceBefore} + ${1})`,
      )

      assert((await object.tokenShares(tokenId)).eq(buyShares), 'buy shares amount != estimated')
    })
  })

  it(`stage sale object`, async () => {
    const objectId = 1
    const objectAddress = await objectsFactory.objectAddress(objectId)
    const stageId = 1
    const maxShares = 100
    const intialStageAvailableShares = 10
    const intialStageSaleStopTimestamp = 0
    const priceOneShare = ethers.utils.parseUnits('100', 18)
    const referralProgramEnabled = true

    await objectsFactory
      .connect(ownersMultisigImpersonated)
      .createStageSaleObject(
        maxShares,
        intialStageAvailableShares,
        intialStageSaleStopTimestamp,
        priceOneShare,
        referralProgramEnabled,
      )

    const object = Object__factory.connect(objectAddress, ethers.provider)
  })

  it('Regular: Upgarde only deployer', async () => {
    const objectsFactoryFactory = await ethers.getContractFactory('ObjectsFactory')
    const newObjectsFactory = await objectsFactoryFactory.deploy()

    await objectsFactory.connect(ownersMultisigImpersonated).upgradeTo(newObjectsFactory.address)
    const implementationAddress = await getImplementationAddress(
      ethers.provider,
      objectsFactory.address,
    )
    assert(
      implementationAddress == newObjectsFactory.address,
      `implementationAddress != newObjectsFactory.address. ${implementationAddress} != ${newObjectsFactory.address}`,
    )
  })

  it('Error unit: Upgarde not owner', async () => {
    const users: Record<string, SignerWithAddress> = {
      user: user,
      administrator: administrator,
    }
    for (const name of Object.keys(users)) {
      console.log(`caller: ${name}`)
      const signer = users[name]
      await expect(
        objectsFactory.connect(signer).upgradeTo(ethers.constants.AddressZero),
      ).to.be.revertedWith('only owners multisig!')
    }
  })
})