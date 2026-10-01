# 收款码放这里

把你的**微信 / 支付宝收款码**图片存成：

```
site/assets/pay.png
```

然后跑一次：

```
npm run report:offline
```

`report/sponsor/assets/pay.png` 会自动生成，商务合作页就会显示收款码；没放图时页面显示的是占位说明，不会出现空白框。

建议：收款码图片宽度 600–800px 即可，别放带个人手机号的截图。
