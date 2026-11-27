// 可配置项。改完直接刷新即可，不需要构建。

// 字体样式表的地址。页面会在启动后自己插入这个样式表，字体只在需要时才下载。
//
// 中国大陆的用户访问 Google Fonts 可能很慢或打不开。可以换成路径相同的镜像，
// 例如 https://fonts.loli.net/css2?family=...（把域名换掉，后面的参数照抄），
// 也可以换成自己服务器上的样式表（里面写好 @font-face，字体文件放在同一个站点）。
// 填空字符串 '' 则完全不联网取字体，只用系统自带字体。
export const FONT_CSS_URL = 'https://fonts.loli.net/css2?family=Noto+Sans+JP:wght@400;500;700&family=Noto+Sans+SC:wght@400;500;700&family=Noto+Serif+JP:wght@400;600&family=Noto+Serif+SC:wght@400;600&family=Zen+Maru+Gothic:wght@400;500;700&family=Klee+One:wght@400;600&family=Roboto+Mono:wght@400;500&display=swap';

// 应用版本号。每次发布改一下，同时改 sw.js 里的缓存名（见 README）。
export const APP_VERSION = '1.4.3';
