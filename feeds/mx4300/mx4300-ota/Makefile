include $(TOPDIR)/rules.mk

PKG_NAME:=mx4300-ota
PKG_VERSION:=1
PKG_RELEASE:=1
PKG_LICENSE:=GPL-2.0-only
PKG_MAINTAINER:=Myles Liu <lyx981mike@gmail.com>

include $(INCLUDE_DIR)/package.mk

define Package/mx4300-ota
  SECTION:=utils
  CATEGORY:=Utilities
  TITLE:=Signed A/B firmware updates from GitHub releases (Linksys MX4300)
  DEPENDS:=@TARGET_qualcommax_ipq807x_DEVICE_linksys_mx4300 \
	+uclient-fetch +ca-bundle +usign +jsonfilter
  PKGARCH:=all
endef

define Package/mx4300-ota/description
  Looks up the newest GitHub release of the repository that built the
  image, verifies its usign-signed checksums and flashes it into the
  other boot partition. The new firmware's first boot is a trial that is
  rolled back unless it is confirmed.
endef

define Package/mx4300-ota/conffiles
/etc/config/mx4300-ota
endef

define Build/Compile
endef

define Package/mx4300-ota/install
	$(INSTALL_DIR) $(1)/usr/sbin $(1)/etc/init.d $(1)/etc/config
	$(INSTALL_BIN) ./files/mx4300-ota $(1)/usr/sbin/mx4300-ota
	$(INSTALL_BIN) ./files/mx4300-ota.init $(1)/etc/init.d/mx4300-ota
	$(INSTALL_CONF) ./files/mx4300-ota.config $(1)/etc/config/mx4300-ota
endef

$(eval $(call BuildPackage,mx4300-ota))
