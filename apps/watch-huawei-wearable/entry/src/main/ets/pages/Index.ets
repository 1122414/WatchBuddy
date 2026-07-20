@Entry
@Component
struct Index {
  build() {
    Stack() {
      Column({ space: 10 }) {
        Text('WatchBuddy')
          .fontSize(28)
          .fontWeight(FontWeight.Bold)
          .fontColor('#F4F7FB')

        Text('智能穿戴架构已就绪')
          .fontSize(18)
          .fontColor('#7BF2BF')
      }
      .alignItems(HorizontalAlign.Center)
      .justifyContent(FlexAlign.Center)
      .width('100%')
      .height('100%')
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#0C1018')
  }
}
