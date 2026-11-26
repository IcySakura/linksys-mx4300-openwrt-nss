include $(TOPDIR)/rules.mk

PKG_NAME:=nss-eip-firmware
PKG_VERSION:=2.5.7
PKG_RELEASE:=1

EIP_FW_COMMIT:=0d970dbf0185e3f53709bd803e8a466598023c57
EIP_FW_URL:=https://raw.githubusercontent.com/qosmio/nss-packages/$(EIP_FW_COMMIT)/firmware/nss-eip-firmware/src

include $(INCLUDE_DIR)/package.mk

define Package/nss-eip-firmware
  SECTION:=firmware
  CATEGORY:=Firmware
  TITLE:=NSS EIP-197 classification engine firmware
  DEPENDS:=@(TARGET_qualcommax_ipq807x||TARGET_qualcommax_ipq60xx)
endef

define Package/nss-eip-firmware/description
  Firmware images (ifpp, ipue, ofpp, opue) for the EIP-197 hardware crypto
  engine driven by NSS Core 1.
endef

define Download/eip197-ifpp
  URL:=$(EIP_FW_URL)
  URL_FILE:=ifpp.bin
  FILE:=nss-eip197-$(PKG_VERSION)-ifpp.bin
  HASH:=a420599255a35196c5c73f23ea2e892ab83b3675a8ca5b894c63ed711c456aac
endef
$(eval $(call Download,eip197-ifpp))

define Download/eip197-ipue
  URL:=$(EIP_FW_URL)
  URL_FILE:=ipue.bin
  FILE:=nss-eip197-$(PKG_VERSION)-ipue.bin
  HASH:=ee25a17e009e53a91f3e0a573149e7d4eaf55250859a2ec998ef333e7a0b26cc
endef
$(eval $(call Download,eip197-ipue))

define Download/eip197-ofpp
  URL:=$(EIP_FW_URL)
  URL_FILE:=ofpp.bin
  FILE:=nss-eip197-$(PKG_VERSION)-ofpp.bin
  HASH:=4f295aa2c13cf09441cc8828aef7e8a903972695c095145976b640fc45b012b2
endef
$(eval $(call Download,eip197-ofpp))

define Download/eip197-opue
  URL:=$(EIP_FW_URL)
  URL_FILE:=opue.bin
  FILE:=nss-eip197-$(PKG_VERSION)-opue.bin
  HASH:=39d19b323161e0def2aa8ac166d691e61ff43ddf337bfd4426c83318daf01ed9
endef
$(eval $(call Download,eip197-opue))

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(CP) $(DL_DIR)/nss-eip197-$(PKG_VERSION)-ifpp.bin $(PKG_BUILD_DIR)/ifpp.bin
	$(CP) $(DL_DIR)/nss-eip197-$(PKG_VERSION)-ipue.bin $(PKG_BUILD_DIR)/ipue.bin
	$(CP) $(DL_DIR)/nss-eip197-$(PKG_VERSION)-ofpp.bin $(PKG_BUILD_DIR)/ofpp.bin
	$(CP) $(DL_DIR)/nss-eip197-$(PKG_VERSION)-opue.bin $(PKG_BUILD_DIR)/opue.bin
endef

define Build/Compile
endef

define Package/nss-eip-firmware/install
	$(INSTALL_DIR) $(1)/lib/firmware
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/ifpp.bin $(1)/lib/firmware/ifpp.bin
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/ipue.bin $(1)/lib/firmware/ipue.bin
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/ofpp.bin $(1)/lib/firmware/ofpp.bin
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/opue.bin $(1)/lib/firmware/opue.bin
endef

$(eval $(call BuildPackage,nss-eip-firmware))
