import './xd_connection';
import Events from 'events';

let iFrameTop = 112;

class VkIframeSdk extends Events{
    static Events = {
        initFail:       "initFail",
        initSuccess:    "initSuccess",
        scroll:         "scroll",
    };

    /**
     * VkIframeSdk constructor.
     * @param {object} photoUploader
     * @param {string} [v] - API version.
     * @param {uploadFunction} photoUploader.upload
     * @constructor
     */
    constructor({photoUploader, v}){
        super();

        this.VK = window.VK;
        this.v = v || "5.71";               //api version
        this.lastRequestTime = 0;           //the time of the last request
        this.photoUploader = photoUploader; //object for upload photo via proxy
        this._disableScroll = false;        //if true onScroll would not be emitted
        this.scrollTop = 0;                 //current scroll position
        this.orderCallback = null;          //callback for onOrder events

        //subscribe to to onScroll events
        this.VK.addCallback('onScroll', (scroll, windowHeight) => {
            if(this._disableScroll) return;
            this.scrollTop = scroll - iFrameTop;
            this.emit(VkIframeSdk.Events.scroll, this.scrollTop, windowHeight);
        });
        //subscribe to to onOrderCancel events
        this.VK.addCallback('onOrderCancel', () => {
            this.orderCallback && this.orderCallback(null, {status: "cancel"});
        });
        //subscribe to to onOrderFail events
        this.VK.addCallback('onOrderFail', (errorCode) => {
            this.orderCallback && this.orderCallback(errorCode);
        });
        //subscribe to to onOrderSuccess events
        this.VK.addCallback('onOrderSuccess', (orderId) => {
            this.orderCallback && this.orderCallback(null, {status: "success", orderId});
        });

        //init vk sdk
        this.VK.init(
            () => this.emit(VkIframeSdk.Events.initSuccess),
            () => this.emit(VkIframeSdk.Events.initFail),
            this.v,
        )
    }

    /**
     * Call api method.
     * @param {string} method - Method name.
     * @param {object} params - Request params.
     * @return {Promise<*>}
     */
    api(method, params={}){
        return new Promise((resolve, reject) => {
            params.v = params.v || this.v;  //api version
            if(window.location.protocol === 'https:')
                params.https = 1;

            //calculate the time remaining until the next request
            let now = Date.now(),
                dt = now - this.lastRequestTime;
            dt = dt > 333 ? 0 : 333 - dt;
            this.lastRequestTime = now + dt;

            setTimeout(() => {
                this.VK.api(method, params, res => {
                    if(res.error && (res.error.error_code === 6 || res.error.error_code === 4)){
                        //if too many requests in second(error_code === 6) or
                        //if invalid sig (error_code === 4) then try request again
                        console.warn('req_error: ',res.error.error_code);
                        this.api(method,params).then(resolve).catch(reject);
                    }else if(res.error){
                        reject(res.error);
                    }else{
                        resolve(res.response);
                    }
                })
            }, dt);
        });
    }

    /**
     * Show dialog for sharing photo to wall.
     * @param {number} [uid] - Wall owner id.
     * @param {string} [message] - Wall post text.
     * @param {string} photo_base64 - Photo as base64.
     * @param {string} [link] - Add link to attachments.
     * @return {Promise<number>}
     */
    async sharePhoto({uid, message, photo_base64, link}){
        let self = this,
            //getting upload url
            uploadServer = await this.api('photos.getWallUploadServer'),
            //uploading photo through proxy
            uploadResult = await this.photoUploader.upload(uploadServer.upload_url, photo_base64),
            //saving photo
            saveResult = await this.api('photos.saveWallPhoto', {
                user_id: uid,
                server: uploadResult.server,
                hash: uploadResult.hash,
                photo: uploadResult.photo,
                caption: message
            }),
            //fix confirmation on mobile
            scroll = saveScroll();

        try{
            let attachments = 'photo'+ saveResult[0].owner_id + '_' + saveResult[0].id;
            //add link to post if exists
            if(link){
                attachments += "," + link
            }
            let postResult = await this.api('wall.post', {
                message,
                attachments,
                owner_id: uid,
            });
            //restore scroll state
            restoreScroll();
            return postResult.post_id;
        }catch(e){
            restoreScroll();
            if(e.error_code === 10007){
                let error = new Error("Canceled by user");
                error.is_cancel = true;
                throw error;
            }
            throw e;
        }

        function saveScroll(){
            self._disableScroll = true;
            self.VK.callMethod('scrollWindow', 0, 0);
            return self.scrollTop;
        }
        function restoreScroll(){
            self._disableScroll = false;
            self.VK.callMethod('scrollWindow', scroll, 0);
        }
    }

    /**
     * Save photo to album.
     * @param {string} photo_base64 - Photo as base64.
     * @param {string} [caption] - Caption of the photo.
     * @param {string} album_name - Album name.
     * @param {string} [album_description] - Description of the album. Will be specified when creating the album.
     * @return {Promise<number>}
     */
    async savePhoto({photo_base64, caption, album_name, album_description}){
        if(!album_name){
            throw new Error("album_name is not defined");
        }

        let albums = await this.api('photos.getAlbums'),
            album = albums.items.filter((alb)=>alb.title === album_name)[0];

        if(!album){
            album = await this.api('photos.createAlbum', {title: album_name, description: album_description});
        }

        let uploadServer = await this.api('photos.getUploadServer', {album_id: album.id}),
            uploadResult = await this.photoUploader.upload(uploadServer.upload_url, photo_base64),
            saveResult = await this.api('photos.save', {
            album_id: album.id,
            server: uploadResult.server,
            photos_list: uploadResult.photos_list,
            hash: uploadResult.hash,
            caption,
        });

        return saveResult[0].id;
    }

    /**
     * Show order box.
     * @param {string} item - Item name
     * @return {Promise<{status: string, orderId: number}>}
     */
    showOrderBox({item}){
        return new Promise((resolve, reject) => {
            this.orderCallback = (err, res) => {
                this.orderCallback = null;
                if(err){
                    reject(err);
                }else{
                    resolve(res);
                }
            };
            this.VK.callMethod('showOrderBox', {type: "item", item});
        });
    }

    /**
     * Resize iframe.
     * @param {number} width
     * @param {number} height
     * @return {{width: number, height: number}}
     */
    resizeWindow(width, height){
        this.VK.callMethod("resizeWindow", width, height);
        return {width: width, height: height};
    }

    /**
     * Add handler to scroll.
     * @param {function} listener
     * @return {function(): (*|void)}
     */
    onWindowScroll(listener){
        this.on(VkIframeSdk.Events.scroll, listener);
        this.VK.callMethod("scrollSubscribe", true);
        return () => this.removeListener("onScroll", listener);
    }

    /**
     * Scroll parent window
     * @param {number} top
     * @param {number} speed
     */
    scrollWindow(top, speed){
        this.VK.callMethod('scrollWindow', top + iFrameTop, speed);
    }
}

/**
 * @callback uploadFunction
 * @param {string} url - URL for upload
 * @param {string} base64 - Photo as base64
 * @param {string} [photo_name] - Photo name
 */


export default VkIframeSdk;

