include $(TOPDIR)/rules.mk

PKG_NAME:=mx4300-cpu-oc
PKG_VERSION:=1
PKG_RELEASE:=1
PKG_LICENSE:=GPL-2.0-only
PKG_MAINTAINER:=Myles Liu <lyx981mike@gmail.com>

include $(INCLUDE_DIR)/package.mk

define Package/mx4300-cpu-oc
  SECTION:=utils
  CATEGORY:=Utilities
  TITLE:=CPU overclocking for the Linksys MX4300 (off by default)
  DEPENDS:=@TARGET_qualcommax_ipq807x_DEVICE_linksys_mx4300 +jsonfilter +libpthread
endef

define Package/mx4300-cpu-oc/description
  Lets the CPU run above its stock 1382.4 MHz (up to 2208 MHz), using the
  firmware's boost operating points. Off unless enabled. Includes a
  stability test, and turns itself off after a crash while overclocked.
endef

define Package/mx4300-cpu-oc/conffiles
/etc/config/mx4300-cpu-oc
/etc/mx4300-cpu-oc.lasttest
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(CP) ./src/* $(PKG_BUILD_DIR)/
endef

define Build/Compile
	$(TARGET_CC) $(TARGET_CFLAGS) $(TARGET_LDFLAGS) -Wall -pthread \
		-o $(PKG_BUILD_DIR)/mx4300-cpu-oc-stress $(PKG_BUILD_DIR)/stress.c
endef

define Package/mx4300-cpu-oc/install
	$(INSTALL_DIR) $(1)/usr/sbin $(1)/usr/libexec $(1)/etc/init.d $(1)/etc/config
	$(INSTALL_BIN) ./files/mx4300-cpu-oc $(1)/usr/sbin/mx4300-cpu-oc
	$(INSTALL_BIN) ./files/mx4300-cpu-oc.init $(1)/etc/init.d/mx4300-cpu-oc
	$(INSTALL_CONF) ./files/mx4300-cpu-oc.config $(1)/etc/config/mx4300-cpu-oc
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/mx4300-cpu-oc-stress $(1)/usr/libexec/mx4300-cpu-oc-stress
endef

$(eval $(call BuildPackage,mx4300-cpu-oc))
