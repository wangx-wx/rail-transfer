/**
 * 城市 → 站点表（自动生成，勿手改）
 *
 * 生成：node tools/gen-stations.mjs（纯静态，零网络）
 * 来源：spike/station_name.js（城市分组）+ 固化主站清单
 * 生成日期：2026-10-04
 *
 * CITY_STATIONS：40 个主要城市，含 Top-N 主站（D18）
 * ALL_CITIES：全部 432 个城市 → 代表站码（兜底，保证任意城市可查）
 *
 * ⚠️ 主站随 OD 变化，本表只是枢纽枚举的候选起点（见 spec/技术方案.md §6.1）。
 */

export const CITY_STATIONS = {
  "北京": {
    "code": "BJP",
    "name": "北京",
    "stations": [
      "BJP",
      "VNP",
      "BXP",
      "FTP"
    ]
  },
  "上海": {
    "code": "SHH",
    "name": "上海",
    "stations": [
      "SHH",
      "AOH",
      "SNH",
      "IMH"
    ]
  },
  "广州": {
    "code": "GZQ",
    "name": "广州",
    "stations": [
      "GZQ",
      "IZQ",
      "GBA",
      "GBQ"
    ]
  },
  "深圳": {
    "code": "SZQ",
    "name": "深圳",
    "stations": [
      "SZQ",
      "IOQ",
      "NZQ",
      "BJQ"
    ]
  },
  "天津": {
    "code": "TJP",
    "name": "天津",
    "stations": [
      "TJP",
      "TXP",
      "TIP",
      "WWP"
    ]
  },
  "重庆": {
    "code": "CQW",
    "name": "重庆",
    "stations": [
      "CQW",
      "CUW",
      "CXW",
      "CYW"
    ]
  },
  "成都": {
    "code": "CDW",
    "name": "成都",
    "stations": [
      "CDW",
      "ICW",
      "CMW",
      "CNW"
    ]
  },
  "杭州": {
    "code": "HZH",
    "name": "杭州",
    "stations": [
      "HZH",
      "HGH",
      "HVU",
      "XHH"
    ]
  },
  "南京": {
    "code": "NJH",
    "name": "南京",
    "stations": [
      "NJH",
      "NKH"
    ]
  },
  "武汉": {
    "code": "WHN",
    "name": "武汉",
    "stations": [
      "WHN",
      "HKN",
      "WCN",
      "LFN"
    ]
  },
  "西安": {
    "code": "XAY",
    "name": "西安",
    "stations": [
      "XAY",
      "EAY",
      "XDY",
      "CAY"
    ]
  },
  "长沙": {
    "code": "CSQ",
    "name": "长沙",
    "stations": [
      "CSQ",
      "CWQ"
    ]
  },
  "郑州": {
    "code": "ZZF",
    "name": "郑州",
    "stations": [
      "ZZF",
      "ZAF",
      "XPF",
      "ZIF"
    ]
  },
  "济南": {
    "code": "JNK",
    "name": "济南",
    "stations": [
      "JNK",
      "JGK",
      "MDK",
      "JAK"
    ]
  },
  "青岛": {
    "code": "QDK",
    "name": "青岛",
    "stations": [
      "QDK",
      "QHK",
      "QUK",
      "CEK"
    ]
  },
  "沈阳": {
    "code": "SYT",
    "name": "沈阳",
    "stations": [
      "SYT",
      "SBT",
      "SOT"
    ]
  },
  "大连": {
    "code": "DLT",
    "name": "大连",
    "stations": [
      "DLT",
      "DFT"
    ]
  },
  "哈尔滨": {
    "code": "HBB",
    "name": "哈尔滨",
    "stations": [
      "HBB",
      "VAB",
      "VBB"
    ]
  },
  "长春": {
    "code": "CCT",
    "name": "长春",
    "stations": [
      "CCT",
      "CRT"
    ]
  },
  "石家庄": {
    "code": "SJP",
    "name": "石家庄",
    "stations": [
      "SJP",
      "VVP",
      "ZHP",
      "GNP"
    ]
  },
  "太原": {
    "code": "TYV",
    "name": "太原",
    "stations": [
      "TYV",
      "TNV"
    ]
  },
  "合肥": {
    "code": "HFH",
    "name": "合肥",
    "stations": [
      "HFH",
      "ENH",
      "COH",
      "HFU"
    ]
  },
  "福州": {
    "code": "FZS",
    "name": "福州",
    "stations": [
      "FZS",
      "FYS"
    ]
  },
  "厦门": {
    "code": "XMS",
    "name": "厦门",
    "stations": [
      "XMS",
      "XKS"
    ]
  },
  "南昌": {
    "code": "NCG",
    "name": "南昌",
    "stations": [
      "NCG",
      "NXG",
      "NUG",
      "HOG"
    ]
  },
  "昆明": {
    "code": "KMM",
    "name": "昆明",
    "stations": [
      "KMM",
      "KOM"
    ]
  },
  "贵阳": {
    "code": "GIW",
    "name": "贵阳",
    "stations": [
      "GIW",
      "KQW",
      "KEW",
      "FVW"
    ]
  },
  "南宁": {
    "code": "NNZ",
    "name": "南宁",
    "stations": [
      "NNZ",
      "NFZ",
      "NRZ"
    ]
  },
  "兰州": {
    "code": "LZJ",
    "name": "兰州",
    "stations": [
      "LZJ",
      "LAJ",
      "ABJ",
      "ZRJ"
    ]
  },
  "西宁": {
    "code": "XNO",
    "name": "西宁",
    "stations": [
      "XNO"
    ]
  },
  "银川": {
    "code": "YIJ",
    "name": "银川",
    "stations": [
      "YIJ",
      "HFJ",
      "UWJ",
      "NOJ"
    ]
  },
  "乌鲁木齐": {
    "code": "WAR",
    "name": "乌鲁木齐",
    "stations": [
      "WAR",
      "WMR"
    ]
  },
  "呼和浩特": {
    "code": "HHC",
    "name": "呼和浩特",
    "stations": [
      "HHC",
      "NDC"
    ]
  },
  "海口": {
    "code": "VUQ",
    "name": "海口",
    "stations": [
      "VUQ"
    ]
  },
  "三亚": {
    "code": "SEQ",
    "name": "三亚",
    "stations": [
      "SEQ"
    ]
  },
  "苏州": {
    "code": "SZH",
    "name": "苏州",
    "stations": [
      "SZH",
      "OHH",
      "ZAU",
      "SMU"
    ]
  },
  "无锡": {
    "code": "WXH",
    "name": "无锡",
    "stations": [
      "WXH",
      "WGH",
      "KYH",
      "IFH"
    ]
  },
  "常州": {
    "code": "CZH",
    "name": "常州",
    "stations": [
      "CZH",
      "ESH",
      "JTU",
      "WJU"
    ]
  },
  "宁波": {
    "code": "NGH",
    "name": "宁波",
    "stations": [
      "NGH"
    ]
  },
  "温州": {
    "code": "RZH",
    "name": "温州",
    "stations": [
      "RZH",
      "VRH",
      "URH",
      "NJU"
    ]
  }
};

export const ALL_CITIES = {"北京":"BJP","重庆":"CQW","上海":"SHH","天津":"TJP","万象":"YTM","南宁":"NNZ","昆明":"KMM","太原":"TYV","长春":"CCT","成都":"CDW","兰州":"LZJ","济南":"JNK","长沙":"CSQ","沈阳":"SYT","福州":"FZS","贵阳":"GIW","广州":"GZQ","哈尔滨":"HBB","合肥":"HFH","呼和浩特":"HHC","海口":"VUQ","杭州":"HZH","拉萨":"LSO","西安":"XAY","南昌":"NCG","南京":"NJH","银川":"YIJ","石家庄":"SJP","武汉":"WHN","乌鲁木齐":"WAR","西宁":"XNO","郑州":"ZZF","齐齐哈尔":"QHX","廊坊":"LJP","绥化":"SHB","兴安":"ARX","湖州":"VZH","安康":"AKY","阿克苏":"ASR","阿图什":"ATR","呼伦贝尔":"AHX","博乐":"BER","阿勒泰":"AUR","孝感":"XGN","安庆":"AQH","安顺":"ASW","鞍山":"AST","安阳":"AYF","黑河":"HJB","玉林":"YLZ","蚌埠":"BBH","喀什":"KSR","白城":"BCT","保定":"BDP","秦皇岛":"QTP","恩施":"ESN","六盘水":"UMW","北海":"BHZ","延边":"BEL","毕节":"BOE","宝鸡":"BJY","七台河":"QTB","儋州":"BFQ","牡丹江":"MDB","朝阳":"BPT","双鸭山":"SSB","鹤岗":"HGB","百色":"BIZ","白山":"HJL","包头":"BTC","本溪":"BXT","巴彦淖尔":"FMC","营口":"YKT","白银":"BXJ","巴中":"IEW","咸阳":"XYY","滨州":"BIK","亳州":"BZH","赤峰":"CID","咸宁":"XNN","常德":"VGQ","承德":"CDP","唐山":"TSP","张家口":"ZMP","许昌":"XCF","汉中":"HOY","凯里":"KLW","吕梁":"LHV","张家界":"DIQ","株洲":"ZZQ","伊春":"YCB","温州":"RZH","东莞":"RTQ","宜宾":"YKE","庆阳":"QOJ","崇仁":"CRG","长寿":"EFW","潮州":"CKQ","广元":"GYW","长汀":"CES","铁岭":"TLT","怀化":"HHQ","邯郸":"HDP","楚雄":"CUM","菏泽":"HIK","汕头":"OTQ","滁州":"CXH","常州":"CZH","长治":"CZF","池州":"IYH","郴州":"CZQ","沧州":"COP","崇左":"CZZ","永州":"AOQ","榆林":"ALY","天水":"TSJ","丹东":"DUT","东方":"UFQ","商洛":"OLY","鸡西":"JXB","酒泉":"JQJ","锦州":"JZD","垫江":"DJE","大同":"DTV","邵阳":"SYQ","大连":"DLT","德令哈":"DHO","渭南":"WNY","大理":"DKM","赣州":"GZG","梅州":"MOQ","大庆":"DZX","鄂尔多斯":"EEC","都匀":"RYW","宿州":"OXH","石嘴山":"OZJ","定西":"DSJ","抚州":"FZG","防城港":"RIZ","德阳":"DYW","宜昌":"YCN","镇江":"ZJH","黄石":"HSN","遂宁":"NIW","东营":"DPK","德州":"DZP","南阳":"NFF","达州":"RXW","乐山":"IVW","阿拉善":"EJC","二连浩特":"RLC","鄂州":"ECN","宁德":"NES","丰都":"FUW","三亚":"SEQ","宁波":"NGH","佳木斯":"JMB","涪陵":"FLW","运城":"YNV","景德镇":"JCG","盐城":"AFH","文山":"FNM","自贡":"ZGE","抚顺":"FET","佛山":"FSQ","深圳":"SZQ","清远":"QBQ","阜新":"FOT","阜阳":"FYH","松原":"VYT","新余":"XUG","曲靖":"QJM","乌兰察布":"WPC","广安":"VJW","宜春":"YEG","格尔木":"GRO","贵港":"GGZ","桂林":"GLZ","加格达奇":"JGX","九江":"JJG","信阳":"XUN","随州":"SZN","中卫":"ZWJ","龙岩":"LYS","聊城":"UCK","固原":"GUJ","连云港":"UIH","茂名":"MDQ","淮安":"AUH","淮北":"HRH","忻州":"XXV","合川":"WKW","河池":"HIZ","金华":"JBH","惠州":"HCQ","陇南":"INJ","临汾":"LFV","伊宁":"YMR","黄冈":"KGN","蒙自":"MZM","库尔勒":"KLR","肇庆":"ZVQ","葫芦岛":"HLD","通辽":"TLD","延安":"YWY","汕尾":"OGQ","南通":"NUH","哈密":"HMR","淮南":"HAH","桦南":"HNB","嘉兴":"JXH","朔州":"SUV","华阴":"HDY","衡水":"HSP","黄山":"HKH","塔城":"TZR","晋中":"JZV","和田":"VTR","衡阳":"HYQ","烟台":"YAK","河源":"VIQ","雅安":"YAE","贺州":"HXZ","吉安":"VAG","辽源":"LYL","通化":"THL","江边村":"JBG","晋城":"JCF","金昌":"JCJ","吉林":"JLL","泉州":"QYS","青岛":"QDK","江门":"JOQ","荆门":"JMN","建宁":"JCS","济宁":"JIK","吉首":"JIQ","衢州":"QEH","嘉峪关":"JGJ","宣城":"ECH","绵阳":"MYW","荆州":"JBN","六安":"UAH","焦作":"JOF","开封":"KFF","克拉玛依":"KHR","苏州":"SZH","三门峡":"SMF","来宾":"UBZ","临沧":"LXM","内江":"NJW","韶关":"SNQ","临川":"LCG","澄迈":"ACQ","娄底":"LDQ","漯河":"LON","江津":"LNE","丽江":"LHM","林口":"LKB","梁平":"UQW","陵水":"LIQ","丽水":"USH","日照":"RZK","泸州":"LUE","邢台":"XTP","辽阳":"LYT","洛阳":"LYF","临沂":"LVK","林芝":"LZO","柳州":"LZZ","南充":"NCW","马鞍山":"MAH","磨丁":"VBM","勐腊":"MWM","海东":"LVO","西昌":"ECW","昌吉":"MSR","商丘":"SQF","眉山":"MSW","茫崖":"HTO","海北州":"MYO","南平":"NOS","那曲":"NQO","阳泉":"AQP","平顶山":"PEN","普洱":"PEM","盘锦":"PVD","平凉":"PIJ","揭阳":"JYA","保山":"BAM","彭水":"PHW","莆田":"PTS","萍乡":"PXG","濮阳":"PYF","攀枝花":"PRW","蕲春":"QRN","琼海":"QYQ","綦江":"QDE","黔江":"QNW","三明":"SVS","吴忠":"WVJ","钦州":"QRZ","荣昌":"RQW","威海":"WKK","日喀则":"RKO","任丘":"RQI","石河子":"SZR","台州":"TEU","徐州":"XCH","四平":"SPT","周口":"ZKN","宿迁":"SQU","上饶":"SRG","吐鲁番":"TFR","湘潭":"XTQ","铜仁":"RDQ","绍兴":"SOH","十堰":"SNN","深州":"SZI","石柱":"OSW","泰安":"TMK","铜川":"TBY","玉溪":"AXM","铜陵":"TJH","天门":"TKN","潼南":"TVW","遵义":"ZYE","枣庄":"ZEK","泰州":"UTH","文昌":"WEQ","潍坊":"WFK","乌海":"IAC","芜湖":"WHH","武隆":"WLW","兴义":"XRZ","武威":"WUJ","武穴":"WXN","无锡":"WXH","万州":"WYW","梧州":"WZZ","香港":"XJA","锡林郭勒":"XTC","厦门":"XMS","秀山":"ETW","景洪":"ENM","仙桃":"VTN","新乡":"XXF","襄阳":"XFN","永川":"WMW","阳江":"WRQ","于都":"YDG","云浮":"IXQ","玉环":"YHU","鹰潭":"YTG","漳州":"ZUS","岳阳":"YYQ","益阳":"AEQ","扬州":"YLH","淄博":"ZBK","珠海":"ZHQ","湛江":"ZJZ","富平":"FPY","驻马店":"ZDN","中山":"ZSQ","昭通":"ZDW","资阳":"FYW","张掖":"ZYJ","安溪":"AXS","璧山":"FZW","蒲城":"CZY","青铜峡":"DBJ","邵东":"SOQ","玉门":"DWJ","建德":"DUU","当阳":"DXN","大足":"FQW","峨山":"EVM","奉节":"FJE","凤阳":"FUH","贡嘎":"GGO","岗嘎":"GAO","个旧":"JJM","鹤壁":"HAF","汉川":"KFN","万宁":"WNQ","乐东":"UQQ","加查":"JIO","巴音郭楞蒙古自治州":"JSR","京山":"MIN","上杭":"JBS","济源":"JYF","琅勃拉邦":"VJM","临高":"KGQ","灵武":"LNJ","莱芜":"UXK","朗县":"LIO","芦溪":"LUG","来舟":"LZS","墨江":"MJM","米林":"MIO","马桥河":"MQB","孟赛":"VFM","麦园":"MYS","纳堆":"VCM","宁洱":"NEM","潜江":"QJN","昌江":"QZQ","山南":"SAO","神农架":"SMN","桑日":"SRO","沙县":"SAS","海西州":"WIO","温岭":"WXU","老挝万荣":"VOM","巫山":"WOE","浠水":"XZN","南涧":"XNM","宜城":"YYN","元江":"AJM","云阳":"YUE","酉阳":"AFW","仪征":"UZH","扎囊":"ZNO","资溪":"ZXS","钟祥":"VKN","阿坝藏族羌族自治州":"HIE","石柱县":"SZE","南川":"NUE","铁门关":"XAR","香格里拉":"EUM","漾濞":"AVM","永平":"APM"};
