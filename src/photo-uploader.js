// @flow
/**
 * Created by Islam on 19.12.2016.
 */

let fsupport = window.fetch && !window.fetch.polyfill && !!window.Blob && !!window.FormData;

export interface PhotoUploader {
    upload(url: string, photo_base64: string, photo_name?: string): any;
}

class VkPhotoUploader implements PhotoUploader{
    proxyUrl: string;
    base64ProxyUrl: string;

    /**
     * Constructor for PhotoUploader.
     * @param {string} proxyUrl - URL for upload photo as binary data.
     * @param {string} base64ProxyUrl - URL for upload photo as base64.
     */
    constructor({proxyUrl, base64ProxyUrl}: {proxyUrl: string, base64ProxyUrl: string}){
        this.proxyUrl = proxyUrl;
        this.base64ProxyUrl = base64ProxyUrl;
    }

    /**
     * Upload photo as binary data via proxy.
     * @param {string} url - Upload URL.
     * @param {string} photo_base64 - Photo as base64 string.
     * @param {string} [photo_name] - Optional. File name to upload.
     * @return {Promise<*>}
     */
    async upload(url: string, photo_base64: string, photo_name?: string = "photo"): any {
        if(!fsupport){
            return await this.uploadAsBase64(url, photo_base64, photo_name);
        }

        let img = b64toBlob(photo_base64.split(',')[1], 'image/jpeg'),	//convert base64 to blob
            data = new FormData();

        //add file to form data
        data.append(photo_name, img, photo_name + '.jpg');

        try{
            //upload photo as file
            return await fetch(this.proxyUrl + url, {method: 'POST', body: data}).then(r => r.json());
        }catch(e){
            //try upload as base64
            return await this.uploadAsBase64(url, photo_base64, photo_name);
        }

    }

    /**
     * Upload photo as base64 via proxy.
     * @param {string} url
     * @param {string} photo_base64
     * @param {string} [photo_name]
     * @return {Promise<Response>}
     */
    async uploadAsBase64(url: string, photo_base64: string, photo_name?: string = "photo"): any {
        let data = "upload_url=" + encodeURIComponent(url);
        data += "&file=" + encodeURIComponent(photo_base64);

        let headers = new Headers();
        headers.set('content-type', 'application/x-www-form-urlencoded');

        return await fetch(this.base64ProxyUrl, {
            headers: headers,
            method: 'POST',
            body: data
        }).then(r => r.json());
    }
}

function b64toBlob(b64Data, contentType, sliceSize) {
	contentType = contentType || '';
	sliceSize = sliceSize || 512;

	let byteCharacters = atob(b64Data),
		byteArrays = [],
		offset = 0;

	for (; offset < byteCharacters.length; offset += sliceSize) {
		let slice = byteCharacters.slice(offset, offset + sliceSize);

		let byteNumbers = new Array(slice.length);
		for (let i = 0; i < slice.length; i++) {
			byteNumbers[i] = slice.charCodeAt(i);
		}

		let byteArray = new Uint8Array(byteNumbers);

		byteArrays.push(byteArray);
	}

	return new Blob(byteArrays, {type: contentType});
}

export default VkPhotoUploader;